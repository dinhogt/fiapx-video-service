export type PublishMessageInput = {
  destination: string;
  type: string;
  body: unknown;
};

export interface MessagePublisher {
  publish(input: PublishMessageInput): Promise<void>;
}
