import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classGoogle';

const configManager = new CLASSES.GoogleDriveHelper();

export const handler: APIGatewayProxyHandler = async () => {
    const token = await configManager.getAccessToken();
    return formatResponse(200, {
        status: 'success',
        token: token,
        timestamp: new Date().toISOString()
    });
};
