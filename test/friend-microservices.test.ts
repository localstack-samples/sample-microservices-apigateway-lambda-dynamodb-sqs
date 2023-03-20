import * as cdk from "aws-cdk-lib";
import { FriendMicroservicesStack } from "../lib/friend-microservices-stack";
import { Template } from "aws-cdk-lib/assertions";

test("resource count test", () => {
  const app = new cdk.App();
  const stack = new FriendMicroservicesStack(app, "TestStack");
  const template = Template.fromStack(stack);

  template.resourceCountIs("AWS::Lambda::Function", 6);
  template.resourceCountIs("AWS::DynamoDB::Table", 1);
  template.resourceCountIs("AWS::SQS::Queue", 2);
});
