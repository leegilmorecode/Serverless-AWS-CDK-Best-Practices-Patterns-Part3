import * as AWS from 'aws-sdk';

import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';

import { v4 as uuid } from 'uuid';

type Order = {
  id: string;
  quantity: number;
  productId: string;
  storeId: string;
  created: string;
  type: string;
};

type Store = {
  id: string;
  storeCode: string;
  storeName: string;
  type: string;
};
type Stores = Store[];

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = 'create-order.handler';
    const prefix = `${correlationId} (v2) - ${method}`;

    console.log(`${prefix} - started`);

    if (!process.env.TABLE_NAME) {
      throw new Error('no table name supplied');
    }

    if (!process.env.BUCKET_NAME) {
      throw new Error('bucket name not supplied');
    }

    if (!event.body) {
      throw new Error('no order supplied');
    }

    // we take the body (payload) from the event coming through from api gateway
    const item = JSON.parse(event.body);

    const ordersTable = process.env.TABLE_NAME;
    const bucketName = process.env.BUCKET_NAME;

    // we wont validate the input with this being a basic example only
    const createdDateTime = new Date().toISOString();

    const order: Order = {
      id: uuid(),
      type: 'Orders',
      created: createdDateTime,
      ...item,
    };

    console.log(`${prefix} - order: ${JSON.stringify(order)}`);

    // we validate that the order is for a real store that we have in config
    const getParams: AWS.DynamoDB.DocumentClient.QueryInput = {
      TableName: ordersTable,
      IndexName: 'storeIndex',
      KeyConditionExpression: '#type = :type',
      ExpressionAttributeNames: {
        '#type': 'type',
      },
      ExpressionAttributeValues: {
        ':type': 'Stores',
      },
    };

    const { Items: items } = await dynamoDb.query(getParams).promise();
    const stores = items as Stores;

    if (!stores.find((item) => item.id === order.storeId)) {
      throw new Error(`${order.storeId} is not found`);
    }

    const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
      TableName: ordersTable,
      Item: order,
    };

    console.log(`${prefix} - create order: ${JSON.stringify(order)}`);

    await dynamoDb.put(params).promise();

    // create a text invoice and push to s3 bucket
    const bucketParams: AWS.S3.PutObjectRequest = {
      Bucket: bucketName,
      Key: `${order.id}-invoice.txt`,
      Body: JSON.stringify(order),
    };

    await s3.upload(bucketParams, {}).promise();

    console.log(`${prefix} - invoice written to ${bucketName}`);

    // api gateway needs us to return this body (stringified) and the status code

    return {
      body: JSON.stringify(order),
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
        'Access-Control-Allow-Credentials': true,
      },
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};
