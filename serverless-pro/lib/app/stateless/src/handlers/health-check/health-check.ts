import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

import { v4 as uuid } from 'uuid';

export const handler: APIGatewayProxyHandler =
  async (): Promise<APIGatewayProxyResult> => {
    try {
      const correlationId = uuid();
      const method = 'health-check.handler';
      const prefix = `${correlationId} (v2) - ${method}`;

      console.log(`${prefix} - success`);
      return {
        statusCode: 200,
        body: JSON.stringify('success'),
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
