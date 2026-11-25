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
    --attributes "{
      \"VisibilityTimeout\": \"${visibility}\",
      \"MessageRetentionPeriod\": \"${retention}\",
      \"ReceiveMessageWaitTimeSeconds\": \"20\",
      \"SqsManagedSseEnabled\": \"true\"
    }" >/dev/null
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

  awslocal sqs create-queue \
    --queue-name "${name}" \
    --attributes "{
      \"VisibilityTimeout\": \"${visibility}\",
      \"MessageRetentionPeriod\": \"${retention}\",
      \"ReceiveMessageWaitTimeSeconds\": \"20\",
      \"SqsManagedSseEnabled\": \"true\",
      \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"${dlq_arn}\\\",\\\"maxReceiveCount\\\":\\\"${max_receive}\\\"}\"
    }" >/dev/null
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

# Tópicos SNS (B8)
VIDEO_TOPIC_ARN="$(awslocal sns create-topic --name "fiapx-${ENV}-video-events" --query TopicArn --output text)"
USER_TOPIC_ARN="$(awslocal sns create-topic --name "fiapx-${ENV}-user-events" --query TopicArn --output text)"

# Permitir SNS → SQS
awslocal sqs set-queue-attributes \
  --queue-url "$(awslocal sqs get-queue-url --queue-name "fiapx-${ENV}-video-status-updates" --query QueueUrl --output text)" \
  --attributes "{\"Policy\": \"{\\\"Version\\\":\\\"2012-10-17\\\",\\\"Statement\\\":[{\\\"Effect\\\":\\\"Allow\\\",\\\"Principal\\\":\\\"*\\\",\\\"Action\\\":\\\"sqs:SendMessage\\\",\\\"Resource\\\":\\\"${STATUS_ARN}\\\",\\\"Condition\\\":{\\\"ArnEquals\\\":{\\\"aws:SourceArn\\\":\\\"${VIDEO_TOPIC_ARN}\\\"}}}]}\"}" >/dev/null

awslocal sqs set-queue-attributes \
  --queue-url "$(awslocal sqs get-queue-url --queue-name "fiapx-${ENV}-notifications" --query QueueUrl --output text)" \
  --attributes "{\"Policy\": \"{\\\"Version\\\":\\\"2012-10-17\\\",\\\"Statement\\\":[{\\\"Effect\\\":\\\"Allow\\\",\\\"Principal\\\":\\\"*\\\",\\\"Action\\\":\\\"sqs:SendMessage\\\",\\\"Resource\\\":\\\"${NOTIF_ARN}\\\",\\\"Condition\\\":{\\\"ArnEquals\\\":{\\\"aws:SourceArn\\\":\\\"${VIDEO_TOPIC_ARN}\\\"}}}]}\"}" >/dev/null

awslocal sqs set-queue-attributes \
  --queue-url "$(awslocal sqs get-queue-url --queue-name "fiapx-${ENV}-user-contacts" --query QueueUrl --output text)" \
  --attributes "{\"Policy\": \"{\\\"Version\\\":\\\"2012-10-17\\\",\\\"Statement\\\":[{\\\"Effect\\\":\\\"Allow\\\",\\\"Principal\\\":\\\"*\\\",\\\"Action\\\":\\\"sqs:SendMessage\\\",\\\"Resource\\\":\\\"${CONTACTS_ARN}\\\",\\\"Condition\\\":{\\\"ArnEquals\\\":{\\\"aws:SourceArn\\\":\\\"${USER_TOPIC_ARN}\\\"}}}]}\"}" >/dev/null

# Inscrições: status (todos), notifications (video.failed), contacts (user.registered)
awslocal sns subscribe \
  --topic-arn "${VIDEO_TOPIC_ARN}" \
  --protocol sqs \
  --notification-endpoint "${STATUS_ARN}" \
  --attributes RawMessageDelivery=true >/dev/null

awslocal sns subscribe \
  --topic-arn "${VIDEO_TOPIC_ARN}" \
  --protocol sqs \
  --notification-endpoint "${NOTIF_ARN}" \
  --attributes "RawMessageDelivery=true,FilterPolicyScope=MessageBody,FilterPolicy={\"type\":[\"video.failed\"]}" >/dev/null

awslocal sns subscribe \
  --topic-arn "${USER_TOPIC_ARN}" \
  --protocol sqs \
  --notification-endpoint "${CONTACTS_ARN}" \
  --attributes "RawMessageDelivery=true,FilterPolicyScope=MessageBody,FilterPolicy={\"type\":[\"user.registered\"]}" >/dev/null

# Bucket local (B7) + lifecycle raw/1d, output/7d, multipart abort 1d
BUCKET="fiapx-local-videos"
awslocal s3 mb "s3://${BUCKET}" || true
awslocal s3api put-bucket-encryption \
  --bucket "${BUCKET}" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' >/dev/null || true
awslocal s3api put-public-access-block \
  --bucket "${BUCKET}" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null || true
awslocal s3api put-bucket-lifecycle-configuration \
  --bucket "${BUCKET}" \
  --lifecycle-configuration '{
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
  }' >/dev/null

echo "[fiapx] LocalStack resources ready"
awslocal sqs list-queues
awslocal sns list-topics
awslocal s3 ls
