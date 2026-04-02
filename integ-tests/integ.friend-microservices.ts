/// !cdk-integ FriendMicroservicesIntegStack
import "source-map-support/register";
import { IntegTest, ExpectedResult } from "@aws-cdk/integ-tests-alpha";
import { App, Duration } from "aws-cdk-lib";
import { FriendMicroservicesStack } from "../lib/friend-microservices-stack";

const app = new App();

// Stack under test
// NOTE: Do NOT set explicit `env` - integ-runner provides CDK_DEFAULT_ACCOUNT
// and CDK_DEFAULT_REGION, and the assertion stack must share the same environment.
const stackUnderTest = new FriendMicroservicesStack(
  app,
  "FriendMicroservicesIntegStack"
);

// Create integration test
const integ = new IntegTest(app, "FriendMicroservicesIntegTest", {
  testCases: [stackUnderTest],
  cdkCommandOptions: {
    destroy: {
      args: {
        force: true,
      },
    },
  },
  regions: ["us-east-1"],
});

// ============================================================================
// Test 1: Send a friend request via SQS and verify the DynamoDB record
// ============================================================================

// Send a "Request" action to the SQS queue
const sendFriendRequest = integ.assertions.awsApiCall("SQS", "sendMessage", {
  QueueUrl: stackUnderTest.queueUrl,
  MessageBody: JSON.stringify({
    player_id: "player-integ-1",
    friend_id: "player-integ-2",
    friend_action: "Request",
  }),
});

// Wait for the Lambda to process and write to DynamoDB
// The frontHandler reads from SQS and writes a "Requested" record
const verifyDynamoDbRecord = integ.assertions
  .awsApiCall("DynamoDB", "getItem", {
    TableName: stackUnderTest.tableName,
    Key: {
      player_id: { S: "player-integ-1" },
      friend_id: { S: "player-integ-2" },
    },
  })
  .expect(
    ExpectedResult.objectLike({
      Item: {
        player_id: { S: "player-integ-1" },
        friend_id: { S: "player-integ-2" },
        state: { S: "Requested" },
      },
    })
  )
  .waitForAssertions({
    totalTimeout: Duration.minutes(2),
    interval: Duration.seconds(10),
  });

// Chain: send request → verify DynamoDB
sendFriendRequest.next(verifyDynamoDbRecord);

// ============================================================================
// Test 2: Verify the requestStateHandler created the reverse "Pending" record
// (DynamoDB Stream → requestStateHandler creates player-integ-2 → player-integ-1 as Pending)
// ============================================================================

const verifyPendingRecord = integ.assertions
  .awsApiCall("DynamoDB", "getItem", {
    TableName: stackUnderTest.tableName,
    Key: {
      player_id: { S: "player-integ-2" },
      friend_id: { S: "player-integ-1" },
    },
  })
  .expect(
    ExpectedResult.objectLike({
      Item: {
        player_id: { S: "player-integ-2" },
        friend_id: { S: "player-integ-1" },
        state: { S: "Pending" },
      },
    })
  )
  .waitForAssertions({
    totalTimeout: Duration.minutes(2),
    interval: Duration.seconds(10),
  });

// Chain: verify DynamoDB requested record → verify pending record
verifyDynamoDbRecord.next(verifyPendingRecord);

// ============================================================================
// Test 3: Accept the friend request and verify both records become "Friends"
// ============================================================================

// Send an "Accept" action for player-integ-2 accepting player-integ-1
const sendAccept = integ.assertions.awsApiCall("SQS", "sendMessage", {
  QueueUrl: stackUnderTest.queueUrl,
  MessageBody: JSON.stringify({
    player_id: "player-integ-2",
    friend_id: "player-integ-1",
    friend_action: "Accept",
  }),
});

// Verify player-integ-2's record is now "Friends"
const verifyAcceptedRecord = integ.assertions
  .awsApiCall("DynamoDB", "getItem", {
    TableName: stackUnderTest.tableName,
    Key: {
      player_id: { S: "player-integ-2" },
      friend_id: { S: "player-integ-1" },
    },
  })
  .expect(
    ExpectedResult.objectLike({
      Item: {
        player_id: { S: "player-integ-2" },
        friend_id: { S: "player-integ-1" },
        state: { S: "Friends" },
      },
    })
  )
  .waitForAssertions({
    totalTimeout: Duration.minutes(2),
    interval: Duration.seconds(10),
  });

// Verify the acceptStateHandler also updated player-integ-1's record to "Friends"
const verifyReverseAccepted = integ.assertions
  .awsApiCall("DynamoDB", "getItem", {
    TableName: stackUnderTest.tableName,
    Key: {
      player_id: { S: "player-integ-1" },
      friend_id: { S: "player-integ-2" },
    },
  })
  .expect(
    ExpectedResult.objectLike({
      Item: {
        player_id: { S: "player-integ-1" },
        friend_id: { S: "player-integ-2" },
        state: { S: "Friends" },
      },
    })
  )
  .waitForAssertions({
    totalTimeout: Duration.minutes(2),
    interval: Duration.seconds(10),
  });

// Chain: verify pending → send accept → verify accepted → verify reverse accepted
verifyPendingRecord
  .next(sendAccept)
  .next(verifyAcceptedRecord)
  .next(verifyReverseAccepted);
