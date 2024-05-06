import {
  AttributeType,
  BillingMode,
  StreamViewType,
  Table,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import {
  FilterCriteria,
  FilterRule,
  Runtime,
  StartingPosition,
} from "aws-cdk-lib/aws-lambda";
import * as cdk from "aws-cdk-lib";
import { Friend, State } from "../models/friend";
import { keyMap, Keys, tableMap } from "../models/tableDecorator";
import {
  NodejsFunction,
  NodejsFunctionProps,
} from "aws-cdk-lib/aws-lambda-nodejs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import {
  DynamoEventSource,
  SqsDlq,
  SqsEventSource,
  StreamEventSourceProps,
} from "aws-cdk-lib/aws-lambda-event-sources";
import { LambdaRestApi } from "aws-cdk-lib/aws-apigateway";

const friendTableName = tableMap.get(Friend)!;
const friendPk = keyMap.get(Friend)!.get(Keys.PK)!;
const friendSk = keyMap.get(Friend)!.get(Keys.SK)!;

export class FriendMicroservicesStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const functionProp: NodejsFunctionProps = {
      runtime: Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(10000),
      memorySize: 1024,
    };

    const frontHandler = new NodejsFunction(this, "frontHandler", {
      entry: "lambda/frontHandler.ts",
      ...functionProp,
    });
    const requestStateHandler = new NodejsFunction(
      this,
      "requestStateHandler",
      {
        entry: "lambda/requestStateHandler.ts",
        ...functionProp,
      }
    );
    const acceptStateHandler = new NodejsFunction(this, "acceptStateHandler", {
      entry: "lambda/acceptStateHandler.ts",
      ...functionProp,
    });
    const rejectStateHandler = new NodejsFunction(this, "rejectStateHandler", {
      entry: "lambda/rejectStateHandler.ts",
      ...functionProp,
    });
    const unfriendStateHandler = new NodejsFunction(
      this,
      "unfriendStateHandler",
      {
        entry: "lambda/unfriendStateHandler.ts",
        ...functionProp,
      }
    );

    const readHandler = new NodejsFunction(this, "readHandler", {
      entry: "lambda/readHandler.ts",
      ...functionProp,
    });

    const friendTable = new Table(this, "Friend", {
      tableName: friendTableName,
      partitionKey: {
        name: friendPk,
        type: AttributeType.STRING,
      },
      sortKey: {
        name: friendSk,
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    friendTable.grantWriteData(frontHandler);
    friendTable.grantStreamRead(requestStateHandler);
    friendTable.grantWriteData(requestStateHandler);
    friendTable.grantStreamRead(acceptStateHandler);
    friendTable.grantWriteData(acceptStateHandler);
    friendTable.grantStreamRead(rejectStateHandler);
    friendTable.grantWriteData(rejectStateHandler);
    friendTable.grantStreamRead(unfriendStateHandler);
    friendTable.grantWriteData(unfriendStateHandler);
    friendTable.grantReadData(readHandler);

    const frontQueue = new Queue(this, "frontQueue");
    frontHandler.addEventSource(
      new SqsEventSource(frontQueue, {
        reportBatchItemFailures: true,
        batchSize: 5,
      })
    );

    const stateHandlerDLQ = new SqsDlq(new Queue(this, "stateHandleDLQ"));

    const streamEventSourceProps: StreamEventSourceProps = {
      startingPosition: StartingPosition.LATEST,
      batchSize: 5,
      retryAttempts: 1,
      onFailure: stateHandlerDLQ,
      reportBatchItemFailures: true,
    };

    requestStateHandler.addEventSource(
      new DynamoEventSource(friendTable, {
        filters: [
          FilterCriteria.filter({
            eventName: FilterRule.isEqual("INSERT"),
            dynamodb: {
              NewImage: {
                state: { S: FilterRule.isEqual(State.Requested) },
              },
            },
          }),
        ],
        ...streamEventSourceProps,
      })
    );

    acceptStateHandler.addEventSource(
      new DynamoEventSource(friendTable, {
        filters: [
          FilterCriteria.filter({
            eventName: FilterRule.isEqual("MODIFY"),
            dynamodb: {
              NewImage: {
                state: { S: FilterRule.isEqual(State.Friends) },
              },
              OldImage: {
                state: { S: FilterRule.isEqual(State.Pending) },
              },
            },
          }),
        ],
        ...streamEventSourceProps,
      })
    );

    rejectStateHandler.addEventSource(
      new DynamoEventSource(friendTable, {
        filters: [
          FilterCriteria.filter({
            eventName: FilterRule.isEqual("REMOVE"),
            dynamodb: {
              OldImage: {
                state: { S: FilterRule.isEqual(State.Pending) },
              },
            },
          }),
        ],
        ...streamEventSourceProps,
      })
    );

    unfriendStateHandler.addEventSource(
      new DynamoEventSource(friendTable, {
        filters: [
          FilterCriteria.filter({
            eventName: FilterRule.isEqual("REMOVE"),
            dynamodb: {
              OldImage: {
                state: { S: FilterRule.isEqual(State.Friends) },
              },
            },
          }),
        ],
        ...streamEventSourceProps,
      })
    );

    const readAPI = new LambdaRestApi(this, "readAPI", {
      handler: readHandler,
      proxy: false,
    });

    const friends = readAPI.root.addResource("friends");
    friends.addResource("{playerId}").addMethod("GET");
    friends
      .addResource("isFriend")
      .addResource("{playerId}")
      .addResource("{friendId}")
      .addMethod("GET");
  }
}
