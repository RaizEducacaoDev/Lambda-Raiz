import 'source-map-support/register';
import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/apiGateway';
import { formatJSONResponse } from '@libs/apiGateway';
import { middyfy } from '@libs/lambda';
import schema from '@libs/schema';
// import axios from 'axios';

import * as CLASSES from 'src/utilities/classes'

const ConfigManagerGoogle = new CLASSES.ConfigManagerGoogle
const retorno = formatJSONResponse({});

const tokenGoogle: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event) => {
    console.log(event) 
    let token = await ConfigManagerGoogle.getAccessToken();

    retorno.body = JSON.stringify({token});
    retorno.statusCode = 200
    return retorno

}
exports.tokenGoogle = middyfy(tokenGoogle);

const gestores: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event) => {
    console.log(event) 
    let token = await ConfigManagerGoogle.getAccessToken();

    retorno.body = JSON.stringify({token});
    retorno.statusCode = 200
    return retorno

}
exports.tokenGoogle = middyfy(gestores);