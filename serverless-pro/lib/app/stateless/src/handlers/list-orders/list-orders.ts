import * as AWS from 'aws-sdk';

import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

import { v4 as uuid } from 'uuid';

type Order = {
  id: string;
  quantity: number;
  productId: string;
  storeId: string;
  created: string;
  type: string;
};

const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const handler: APIGatewayProxyHandler =
  async (): Promise<APIGatewayProxyResult> => {
    try {
      const correlationId = uuid();
      const method = 'list-orders.handler';
      const prefix = `${correlationId} (v2) - ${method}`;

      if (!process.env.TABLE_NAME) {
        throw new Error('no table name supplied');
      }

      console.log(`${prefix} - started`);

      const ordersTable = process.env.TABLE_NAME;

      const params: AWS.DynamoDB.DocumentClient.ScanInput = {
        TableName: ordersTable,
      };

      // note: for this demo we will use a simple scan
      const { Items } = await dynamoDb.scan(params).promise();

      const orders: Order[] = !Items
        ? []
        : Items?.filter((item) => item.type === 'Orders').map((item) => {
            return {
              id: item.id,
              productId: item.productId,
              quantity: item.quantity,
              storeId: item.storeId,
              created: item.created,
              type: item.type,
            };
          });

      // api gateway needs us to return this body (stringified) and the status code
      return {
        statusCode: 200,
        body: JSON.stringify(orders),
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
