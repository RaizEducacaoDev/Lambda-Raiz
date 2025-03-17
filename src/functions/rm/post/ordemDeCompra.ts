import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classRm';
import * as XML from '../../../utils/xml';
import axios from 'axios';

const ConfigManagerRm = new CLASSES.ConfigManagerRm();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const campos = JSON.parse(event.body as string);

        const ESTOQUE = campos.codigoDaColigada === '1'
            ? `${(campos.filialDeEntrega as string).split(" - ")[0]}.001`
            : `${(campos.unidadeFilial as string).split(" - ")[0]}.001`;

        const CODCOLIGADA = campos.codigoDaColigada === '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        const CODFILIAL = campos.codigoDaColigada === '1'
            ? campos.codigoDaFilial2 || ''
            : campos.codigoDaFilial || '';

        const CODTMVGERADO = campos.tipoDeSolicitacao === 'P'
            ? '1.1.05'
            : '1.1.06';

        let listaDeItens = await ConfigManagerRm.getGanhador(campos.cotacao as string);

        // Lógica para gerar o XML incorporada diretamente
        let listaDeProdutos = (() => {
            try {
                // Agrupa os produtos por fornecedor
                const fornecedores = listaDeItens.reduce((acc: Record<string, any[]>, item: { CODCFO: string }) => {
                    acc[item.CODCFO] = acc[item.CODCFO] || [];
                    acc[item.CODCFO].push(item);
                    return acc;
                }, {});

                let xmlFinal = "";

                // Gera o XML para cada fornecedor
                Object.keys(fornecedores).forEach((fornecedor) => {
                    const produtos = fornecedores[fornecedor];
                    produtos.forEach((produto: { 
                        CODCFO: string;
                        CODCPGNEGOCIADA: string;
                        IDMOV: string;
                        IDPRD: string;
                        NSEQITMMOV: string;
                    }) => {
                        xmlFinal += `
                        <a:ProdutoInclusaoMov>
                            <a:InternalId i:nil="true" />
                            <codCCusto>${campos.codigoDoCentroDeCusto}</codCCusto>
                            <codCfo>${produto.CODCFO}</codCfo>
                            <codColCfo>0</codColCfo>
                            <codColMov>${CODCOLIGADA}</codColMov>
                            <codCpgNegociada>${produto.CODCPGNEGOCIADA}</codCpgNegociada>
                            <codDepartamento />
                            <codFilial>${CODFILIAL}</codFilial>
                            <codFilialEntrega>0</codFilialEntrega>
                            <codLoc>${ESTOQUE}</codLoc>
                            <codLocEntrega />
                            <codMoeda>R$</codMoeda>
                            <codRpr />
                            <codTmvGerado>${CODTMVGERADO}</codTmvGerado>
                            <codTraParadigma />
                            <despesa>0</despesa>
                            <freteCifOuFobParadigma>0</freteCifOuFobParadigma>
                            <idClassMovGerado>0</idClassMovGerado>
                            <idMov>${produto.IDMOV}</idMov>
                            <idPrd>${produto.IDPRD}</idPrd>
                            <movimento>0</movimento>
                            <nSeqItmMov>${produto.NSEQITMMOV}</nSeqItmMov>
                            <percDesconto>0</percDesconto>
                            <percDespItmNeg>0</percDespItmNeg>
                            <statusParadigma>N</statusParadigma>
                            <valFreteParadigma>0</valFreteParadigma>
                            <valorDesOcrc>0</valorDesOcrc>
                        </a:ProdutoInclusaoMov>`;
                    });
                });

                return xmlFinal;
            } catch (error) {
                console.error("Erro ao gerar XML:", error);
                return "";
            }
        })();

        let envelope =
            `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
            <soapenv:Header />
            <soapenv:Body>
                <tot:ExecuteWithXmlParams>
                    <tot:ProcessServerName>CmpOrdemCompraProc</tot:ProcessServerName>
                    <tot:strXmlParams>
                        <![CDATA[
                            <CmpGerarOrdemCompraProcParams z:Id="i1" xmlns="http://www.totvs.com.br/RM/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:z="http://schemas.microsoft.com/2003/10/Serialization/">
                                <Context z:Id="i2" xmlns="http://www.totvs.com/" xmlns:a="http://www.totvs.com.br/RM/">
                                    <a:_params xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$EXERCICIOFISCAL</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODLOCPRT</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODTIPOCURSO</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$EDUTIPOUSR</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUNIDADEBIB</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODCOLIGADA</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODCOLIGADA}</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$RHTIPOUSR</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODIGOEXTERNO</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODSISTEMA</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">T</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUSUARIOSERVICO</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema" />
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUSUARIO</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">p_heflo</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$IDPRJ</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CHAPAFUNCIONARIO</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODFILIAL</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODFILIAL}</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    </a:_params>
                                    <a:Environment>DotNet</a:Environment>
                                </Context>
                                <ListGerarOrdemCompra xmlns:a="http://www.totvs.com/">
                                    <a:CmpGerarOrdemCompraPar z:Id="i3">
                                    <a:InternalId i:nil="true" />
                                    <codColigada>${CODCOLIGADA}</codColigada>
                                    <codCotacao>${campos.cotacao}</codCotacao>
                                    <codFilial>${CODFILIAL}</codFilial>
                                    <codUsuario>p_heflo</codUsuario>
                                    <listProdutoAlteracao />
                                    <listProdutoInclusao>${listaDeProdutos}</listProdutoInclusao>
                                    </a:CmpGerarOrdemCompraPar>
                                </ListGerarOrdemCompra>
                            </CmpGerarOrdemCompraProcParams>
                        ]]>
                    </tot:strXmlParams>
                </tot:ExecuteWithXmlParams>
            </soapenv:Body>
        </soapenv:Envelope>`

        let response = await axios.post(
            `${ConfigManagerRm.getUrl()}:8051/wsProcess/IwsProcess`,
            envelope,
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
            let OC = await ConfigManagerRm.getOC(campos.cotacao as string, campos.solicitacaoDeCompra as string);
            return formatResponse(200, { OC });
        } else {
            let error = result.match(/^[^\r\n]+/)[0];
            return formatResponse(400, { message: 'Internal Server Error', error: error });
        }

    } catch (error) {
        return formatResponse(500, {  message: 'Internal Server Error',  error: error instanceof Error ? error.message : String(error) });
    }
};