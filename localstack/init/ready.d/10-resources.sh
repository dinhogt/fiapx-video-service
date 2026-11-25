#!/usr/bin/env bash
# Cria os recursos B8 com <env>=local (ADR-010). Roda no ready.d do LocalStack.
set -euo pipefail

ENV="local"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="${REGION}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"

echo "[fiapx] provisioning LocalStack resources for env=${ENV}"

create_queue() {
  local name="$1"
  local visibility="$2"
  local retention="$3"
  awslocal sqs create-queue \
    --queue-name "${name}" \
    --attributes "VisibilityTimeout=${visibility},MessageRetentionPeriod=${retention},ReceiveMessageWaitTimeSeconds=20,SqsManagedSseEnabled=true" \
    >/dev/null
}

create_queue_with_dlq() {
  local name="$1"
  local dlq_name="$2"
  local visibility="$3"
  local retention="$4"
  local max_receive="$5"
  local dlq_retention="$6"

  create_queue "${dlq_name}" "${visibility}" "${dlq_retention}"
  local dlq_url
  dlq_url="$(awslocal sqs get-queue-url --queue-name "${dlq_name}" --query QueueUrl --output text)"
  local dlq_arn
  dlq_arn="$(awslocal sqs get-queue-attributes --queue-url "${dlq_url}" --attribute-names QueueArn --query Attributes.QueueArn --output text)"

  local attrs_file
  attrs_file="$(mktemp)"
  cat >"${attrs_file}" <<EOF
{
  "VisibilityTimeout": "${visibility}",
  "MessageRetentionPeriod": "${retention}",
  "ReceiveMessageWaitTimeSeconds": "20",
  "SqsManagedSseEnabled": "true",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"${dlq_arn}\",\"maxReceiveCount\":\"${max_receive}\"}"
}
EOF
  awslocal sqs create-queue \
    --queue-name "${name}" \
    --attributes "file://${attrs_file}" \
    >/dev/null
  rm -f "${attrs_file}"
}

# 4 filas + 4 DLQs (B8)
create_queue_with_dlq "fiapx-${ENV}-video-process" "fiapx-${ENV}-video-process-dlq" 120 345600 3 1209600
create_queue_with_dlq "fiapx-${ENV}-video-status-updates" "fiapx-${ENV}-video-status-updates-dlq" 30 345600 5 1209600
create_queue_with_dlq "fiapx-${ENV}-notifications" "fiapx-${ENV}-notifications-dlq" 30 345600 5 1209600
create_queue_with_dlq "fiapx-${ENV}-user-contacts" "fiapx-${ENV}-user-contacts-dlq" 30 345600 5 1209600

queue_arn() {
  local url
  url="$(awslocal sqs get-queue-url --queue-name "$1" --query QueueUrl --output text)"
  awslocal sqs get-queue-attributes --queue-url "${url}" --attribute-names QueueArn --query Attributes.QueueArn --output text
}

STATUS_ARN="$(queue_arn "fiapx-${ENV}-video-status-updates")"
NOTIF_ARN="$(queue_arn "fiapx-${ENV}-notifications")"
CONTACTS_ARN="$(queue_arn "fiapx-${ENV}-user-contacts")"

VIDEO_TOPIC_ARN="$(awslocal sns create-topic --name "fiapx-${ENV}-video-events" --query TopicArn --output text)"
USER_TOPIC_ARN="$(awslocal sns create-topic --name "fiapx-${ENV}-user-events" --query TopicArn --output text)"

# Política SQS←SNS (LocalStack não impõe IAM; mantemos para paridade)
allow_sns_to_sqs() {
  local queue_name="$1"
  local queue_arn="$2"
  local topic_arn="$3"
  local queue_url
  queue_url="$(awslocal sqs get-queue-url --queue-name "${queue_name}" --query QueueUrl --output text)"
  local attrs_file
  attrs_file="$(mktemp)"
  cat >"${attrs_file}" <<EOF
{
  "Policy": "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":\"*\",\"Action\":\"sqs:SendMessage\",\"Resource\":\"${queue_arn}\",\"Condition\":{\"ArnEquals\":{\"aws:SourceArn\":\"${topic_arn}\"}}}]}"
}
EOF
  awslocal sqs set-queue-attributes \
    --queue-url "${queue_url}" \
    --attributes "file://${attrs_file}" \
    >/dev/null
  rm -f "${attrs_file}"
}

allow_sns_to_sqs "fiapx-${ENV}-video-status-updates" "${STATUS_ARN}" "${VIDEO_TOPIC_ARN}"
allow_sns_to_sqs "fiapx-${ENV}-notifications" "${NOTIF_ARN}" "${VIDEO_TOPIC_ARN}"
allow_sns_to_sqs "fiapx-${ENV}-user-contacts" "${CONTACTS_ARN}" "${USER_TOPIC_ARN}"

subscribe_sqs() {
  local topic_arn="$1"
  local queue_arn="$2"
  local filter_json="${3:-}"

  local sub_arn
  sub_arn="$(awslocal sns subscribe \
    --topic-arn "${topic_arn}" \
    --protocol sqs \
    --notification-endpoint "${queue_arn}" \
    --attributes RawMessageDelivery=true \
    --query SubscriptionArn --output text)"

  if [[ -n "${filter_json}" ]]; then
    awslocal sns set-subscription-attributes \
      --subscription-arn "${sub_arn}" \
      --attribute-name FilterPolicyScope \
      --attribute-value MessageBody
    awslocal sns set-subscription-attributes \
      --subscription-arn "${sub_arn}" \
      --attribute-name FilterPolicy \
      --attribute-value "${filter_json}"
  fi
}

subscribe_sqs "${VIDEO_TOPIC_ARN}" "${STATUS_ARN}"
subscribe_sqs "${VIDEO_TOPIC_ARN}" "${NOTIF_ARN}" '{"type":["video.failed"]}'
subscribe_sqs "${USER_TOPIC_ARN}" "${CONTACTS_ARN}" '{"type":["user.registered"]}'

BUCKET="fiapx-local-videos"
awslocal s3 mb "s3://${BUCKET}" || true
awslocal s3api put-bucket-encryption \
  --bucket "${BUCKET}" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
  >/dev/null || true
awslocal s3api put-public-access-block \
  --bucket "${BUCKET}" \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
  >/dev/null || true

cat >/tmp/fiapx-lifecycle.json <<'EOF'
{
  "Rules": [
    {
      "ID": "expire-raw",
      "Status": "Enabled",
      "Filter": {"Prefix": "raw/"},
      "Expiration": {"Days": 1}
    },
    {
      "ID": "expire-output",
      "Status": "Enabled",
      "Filter": {"Prefix": "output/"},
      "Expiration": {"Days": 7}
    },
    {
      "ID": "abort-multipart",
      "Status": "Enabled",
      "Filter": {"Prefix": ""},
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1}
    }
  ]
}
EOF
awslocal s3api put-bucket-lifecycle-configuration \
  --bucket "${BUCKET}" \
  --lifecycle-configuration file:///tmp/fiapx-lifecycle.json \
  >/dev/null

echo "[fiapx] LocalStack resources ready"
awslocal sqs list-queues
awslocal sns list-topics
awslocal sns list-subscriptions
awslocal s3 ls
