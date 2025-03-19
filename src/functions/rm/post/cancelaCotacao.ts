import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classRm';
import * as XML from '../../../utils/xml';
import axios from 'axios';

const ConfigManagerRm = new CLASSES.ConfigManagerRm();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const campos = JSON.parse(event.body as string);

        const CODCOLIGADA = campos.codigoDaColigada === '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        var soapEnvelope =
            `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
            <soapenv:Header />
            <soapenv:Body>
                <tot:ExecuteWithXmlParams>
                <tot:ProcessServerName>CmpCancelarCotacaoProc</tot:ProcessServerName>
                <tot:strXmlParams>
                    <![CDATA[<CmpCancelarCotacaoParams xmlns="http://www.totvs.com.br/RM/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
                    <Context xmlns="http://www.totvs.com/" xmlns:a="http://www.totvs.com.br/RM/">
                        <a:_params xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                        <b:KeyValueOfanyTypeanyType>
                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODCOLIGADA</b:Key>
                            <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODCOLIGADA}</b:Value>
                        </b:KeyValueOfanyTypeanyType>
                        <b:KeyValueOfanyTypeanyType>
                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODSISTEMA</b:Key>
                            <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">T</b:Value>
                        </b:KeyValueOfanyTypeanyType>
                        </a:_params>
                    </Context>
                    <PrimaryKeyList xmlns="http://www.totvs.com/" xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                        <a:ArrayOfanyType>
                        <a:anyType i:type="b:string" xmlns:b="http://www.w3.org/2001/XMLSchema">${campos.cotacao}</a:anyType>
                        <a:anyType i:type="b:short" xmlns:b="http://www.w3.org/2001/XMLSchema">${CODCOLIGADA}</a:anyType>
                        </a:ArrayOfanyType>
                    </PrimaryKeyList>
                    <PrimaryKeyNames xmlns="http://www.totvs.com/" xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                        <a:string>CODCOTACAO</a:string>
                        <a:string>CODCOLIGADA</a:string>
                    </PrimaryKeyNames>
                    <CodMotivo/>
                    </CmpCancelarCotacaoParams>]]>
                </tot:strXmlParams>
                </tot:ExecuteWithXmlParams>
            </soapenv:Body>
        </soapenv:Envelope>`

        let response = await axios.post(
            `${ConfigManagerRm.getUrl()}:8051/wsProcess/IwsProcess`,
            soapEnvelope,
            {
                headers: {
                    'Authorization': `Basic ${ConfigManagerRm.getCredentials()}`,
                    'Content-Type': 'text/xml;charset=UTF-8',
                    'SOAPAction': 'http://www.totvs.com/IwsProcess/ExecuteWithXmlParams',
                }
            }
        );

        let result = response.data
        result = await XML.buscaResultadoCotacao(result)

        if (result == '1') {
            let resposta = 'CANCELADO'
            return formatResponse(200, { resposta });
        } else {
            let error = result.match(/^[^\r\n]+/)[0];
            return formatResponse(400, { message: 'Internal Server Error', error: error });
        }

    } catch (error) {
        return formatResponse(500, {  message: 'Internal Server Error',  error: error instanceof Error ? error.message : String(error) });
    }

};