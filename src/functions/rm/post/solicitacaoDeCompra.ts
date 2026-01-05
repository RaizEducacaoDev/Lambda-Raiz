import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as wsDataserver from '../../../utils/wsDataserver';
import * as XML from '../../../utils/xml';

const dataServer = new wsDataserver.wsDataserver();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const campos = JSON.parse(event.body as string);

        const ESTOQUE = campos.codigoDaColigada === '1'
            ? `${(campos.filialDeEntrega as string).split(" - ")[0]}.001`
            : `${(campos.unidadeFilial as string).split(" - ")[0]}.001`;

        const HISTORICOCURTO = campos.tipoDeSolicitacao === 'P'
            ? `MOTIVO DA SOLICITAÇÃO: ${campos.motivoDaSolicitacao}`
            : `MOTIVO DA SOLICITAÇÃO: ${campos.motivoDaSolicitacao}
        DESCRIÇÃO DO SERVIÇO: ${campos.descricaoDoServico}`

        const CODCOLIGADA = campos.codigoDaColigada === '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        const CODFILIAL = campos.codigoDaColigada === '1'
            ? campos.codigoDaFilial2 || ''
            : campos.codigoDaFilial || '';

        const CODTMV = campos.tipoDeSolicitacao === 'P'
            ? '1.1.03'
            : '1.1.04';

        let listaDeItens = campos.itens as object[];
        console.info('[RM-INFO] Campos recebidos:', JSON.stringify(campos, null, 2));

        // Construir tags principais do movimento
        const tagsTMOV = [
            ['CODCOLIGADA', CODCOLIGADA],
            ['IDMOV', '-1'],
            ['CODFILIAL', CODFILIAL],
            ['CODLOC', ESTOQUE],
            ['CODLOCDESTINO', ESTOQUE],
            ['NUMEROMOV', '-1'],
            ['SERIE', 'SC'],
            ['CODTMV', CODTMV],
            ['TIPO', campos.tipoDeSolicitacao],
            ['STATUS', 'A'],
            ['MOVIMPRESSO', '0'],
            ['DOCIMPRESSO', '0'],
            ['FATIMPRESSA', '0'],
            ['COMISSAOREPRES', '0.0000'],
            ['VALORBRUTO', '0.0000'],
            ['VALORLIQUIDO', '0.0000'],
            ['VALOROUTROS', '0.0000'],
            ['PERCCOMISSAO', '0.0000'],
            ['CODMEN', '01'],
            ['PESOLIQUIDO', '0.0000'],
            ['PESOBRUTO', '0.0000'],
            ['CODMOEVALORLIQUIDO', 'R$'],
            ['GEROUFATURA', '0'],
            ['CODCFOAUX', 'CXXXXXXXXXX'],
            ['CODCCUSTO', campos.codigoDoCentroDeCusto],
            ['CODVEN1', campos.codigoDoComprador],
            ['PERCCOMISSAOVEN2', '0.0000'],
            ['CODUSUARIO', 'p_heflo'],
            ['CODFILIALDESTINO', CODFILIAL],
            ['GERADOPORLOTE', '0'],
            ['STATUSEXPORTCONT', '0'],
            ['GEROUCONTATRABALHO', '0'],
            ['GERADOPORCONTATRABALHO', '0'],
            ['INDUSOOBJ', '0.00'],
            ['INTEGRADOBONUM', '0'],
            ['FLAGPROCESSADO', '0'],
            ['ABATIMENTOICMS', '0.0000'],
            ['USUARIOCRIACAO', 'p_heflo'],
            ['STSEMAIL', '0'],
            ['VALORBRUTOINTERNO', '0.0000'],
            ['VINCULADOESTOQUEFL', '0'],
            ['VRBASEINSSOUTRAEMPRESA', '0.0000'],
            ['VALORDESCCONDICIONAL', '0.0000'],
            ['VALORDESPCONDICIONAL', '0.0000'],
            ['INTEGRADOAUTOMACAO', '0'],
            ['INTEGRAAPLICACAO', 'T'],
            ['RECIBONFESTATUS', '0'],
            ['VALORMERCADORIAS', '0.0000'],
            ['USARATEIOVALORFIN', '0'],
            ['CODCOLCFOAUX', '0'],
            ['HISTORICOCURTO', HISTORICOCURTO],
            ['RATEIOCCUSTODEPTO', '0.0000'],
            ['VALORBRUTOORIG', '0.0000'],
            ['VALORLIQUIDOORIG', '0.0000'],
            ['VALOROUTROSORIG', '0.0000'],
            ['FLAGCONCLUSAO', '0'],
            ['STATUSPARADIGMA', 'N'],
            ['STATUSINTEGRACAO', 'N'],
            ['PERCCOMISSAOVEN3', '0.0000'],
            ['PERCCOMISSAOVEN4', '0.0000'],
            ['CODCOLIGADA1', CODCOLIGADA],
            ['IDMOVHST', '-1']
        ].map(([tag, valor]) => XML.montaTag(tag, valor));

        // Construir tags TNFE
        const tagsTNFE = [
            ['CODCOLIGADA', CODCOLIGADA],
            ['IDMOV', '-1'],
            ['VALORSERVICO', '0.0000'],
            ['DEDUCAOSERVICO', '0.0000'],
            ['ALIQUOTAISS', '0.0000'],
            ['ISSRETIDO', '0'],
            ['VALORISS', '0.0000'],
            ['VALORCREDITOIPTU', '0.0000'],
            ['BASEDECALCULO', '0.0000'],
            ['EDITADO', '0']
        ].map(([tag, valor]) => XML.montaTag(tag, valor));

        // Construir tags TMOVFISCAL
        const tagsTMOVFISCAL = [
            ['CODCOLIGADA', CODCOLIGADA],
            ['IDMOV', '-1'],
            ['CONTRIBUINTECREDENCIADO', '0'],
            ['OPERACAOCONSUMIDORFINAL', '0'],
            ['OPERACAOPRESENCIAL', '0']
        ].map(([tag, valor]) => XML.montaTag(tag, valor));

        // Construir tags TMOVRATCCU
        const tagsTMOVRATCCU = [
            ['CODCOLIGADA', CODCOLIGADA],
            ['IDMOV', '-1'],
            ['CODCCUSTO', campos.codigoDoCentroDeCusto],
            ['VALOR', '0.0000'],
            ['IDMOVRATCCU', '-1']
        ].map(([tag, valor]) => XML.montaTag(tag, valor));

        // Construir tags TMOVCOMPL
        const tagsTMOVCOMPL = [
            ['CODCOLIGADA', CODCOLIGADA],
            ['IDMOV', '-1'],
            ['MULTIPLO', 'N'],
            ['HEFLO', campos.ticketRaiz]
        ].map(([tag, valor]) => XML.montaTag(tag, valor));

        // Construir tags TMOVTRANSP
        const tagsTMOVTRANSP = [
            ['CODCOLIGADA', CODCOLIGADA],
            ['IDMOV', '-1'],
            ['RETIRAMERCADORIA', '0'],
            ['TIPOCTE', '0'],
            ['TOMADORTIPO', '0'],
            ['TIPOEMITENTEMDFE', '0'],
            ['LOTACAO', '1'],
            ['TIPOTRANSPORTADORMDFE', '0'],
            ['TIPOBPE', '0']
        ].map(([tag, valor]) => XML.montaTag(tag, valor));

        // Construir itens do movimento
        var xmlContent = '';
        for (let i = 0; i < listaDeItens.length; i++) {
            const item = listaDeItens[i] as { codigoDoItem: string, qtdDoItem: number };
            
            // Tags TITMMOV
            const tagsTITMMOV = [
                ['CODCOLIGADA', CODCOLIGADA],
                ['IDMOV', '-1'],
                ['NSEQITMMOV', (i + 1).toString()],
                ['CODFILIAL', CODFILIAL],
                ['NUMEROSEQUENCIAL', (i + 1).toString()],
                ['IDPRD', item.codigoDoItem],
                ['QUANTIDADE', item.qtdDoItem.toString()],
                ['PRECOUNITARIO', '0.0000000000'],
                ['PRECOTABELA', '0.0000'],
                ['VALORDESC', '0.0000'],
                ['QUANTIDADEARECEBER', item.qtdDoItem.toString()],
                ['VALORUNITARIO', '0.0000'],
                ['VALORFINANCEIRO', '0.0000'],
                ['CODCCUSTO', campos.codigoDoCentroDeCusto],
                ['ALIQORDENACAO', '0.0000'],
                ['QUANTIDADEORIGINAL', item.qtdDoItem.toString()],
                ['FLAG', '0'],
                ['FATORCONVUND', '0.0000'],
                ['VALORBRUTOITEM', '0.0000000000'],
                ['VALORTOTALITEM', '0.0000000000'],
                ['QUANTIDADESEPARADA', '0.0000'],
                ['COMISSAOREPRES', '0.0000'],
                ['VALORESCRITURACAO', '0.0000'],
                ['VALORFINPEDIDO', '0.0000'],
                ['VALOROPFRM1', '0.0000'],
                ['VALOROPFRM2', '0.0000'],
                ['PRECOEDITADO', '0'],
                ['QTDEVOLUMEUNITARIO', '1'],
                ['CODVEN1', campos.codigoDoComprador],
                ['PRECOTOTALEDITADO', '0'],
                ['VALORDESCCONDICONALITM', '0.0000'],
                ['VALORDESPCONDICIONALITM', '0.0000'],
                ['CODTBORCAMENTO', campos.codigoDaNatureza],
                ['CODCOLTBORCAMENTO', '0'],
                ['VALORUNTORCAMENTO', '0.0000'],
                ['VALSERVICONFE', '0.0000'],
                ['CODLOC', ESTOQUE],
                ['VALORBEM', '0.0000'],
                ['VALORLIQUIDO', '0.0000'],
                ['HISTORICOCURTO', HISTORICOCURTO],
                ['RATEIOCCUSTODEPTO', '0.0000'],
                ['VALORBRUTOITEMORIG', '0.0000000000'],
                ['QUANTIDADETOTAL', item.qtdDoItem.toString()],
                ['PRODUTOSUBSTITUTO', '0'],
                ['PRECOUNITARIOSELEC', '2'],
                ['INTEGRAAPLICACAO', 'T'],
                ['VALORBASEDEPRECIACAOBEM', '0.0000'],
                ['CODCOLIGADA1', CODCOLIGADA],
                ['IDMOVHST', '-1'],
                ['NSEQITMMOV1', (i + 1).toString()]
            ].map(([tag, valor]) => XML.montaTag(tag, valor));

            // Tags TITMMOVRATCCU
            const tagsTITMMOVRATCCU = [
                ['CODCOLIGADA', CODCOLIGADA],
                ['IDMOV', '-1'],
                ['NSEQITMMOV', (i + 1).toString()],
                ['CODCCUSTO', campos.codigoDoCentroDeCusto],
                ['VALOR', '0.0000'],
                ['IDMOVRATCCU', '-1']
            ].map(([tag, valor]) => XML.montaTag(tag, valor));

            // Tags TITMMOVCOMPL
            const tagsTITMMOVCOMPL = [
                ['CODCOLIGADA', CODCOLIGADA],
                ['IDMOV', '-1'],
                ['NSEQITMMOV', (i + 1).toString()]
            ].map(([tag, valor]) => XML.montaTag(tag, valor));

            // Tags TITMMOVFISCAL
            const tagsTITMMOVFISCAL = [
                ['CODCOLIGADA', CODCOLIGADA],
                ['IDMOV', '-1'],
                ['NSEQITMMOV', (i + 1).toString()],
                ['QTDECONTRATADA', '0.0000'],
                ['VLRTOTTRIB', '0.0000'],
                ['AQUISICAOPAA', '0'],
                ['POEBTRIBUTAVEL', '1']
            ].map(([tag, valor]) => XML.montaTag(tag, valor));

            xmlContent += '<TITMMOV>';
            tagsTITMMOV.forEach(tag => { xmlContent += tag; });
            xmlContent += '</TITMMOV>';
            
            xmlContent += '<TITMMOVRATCCU>';
            tagsTITMMOVRATCCU.forEach(tag => { xmlContent += tag; });
            xmlContent += '</TITMMOVRATCCU>';
            
            xmlContent += '<TITMMOVCOMPL>';
            tagsTITMMOVCOMPL.forEach(tag => { xmlContent += tag; });
            xmlContent += '</TITMMOVCOMPL>';
            
            xmlContent += '<TITMMOVFISCAL>';
            tagsTITMMOVFISCAL.forEach(tag => { xmlContent += tag; });
            xmlContent += '</TITMMOVFISCAL>';
        }

        // Construir CDATA completo
        let cData = '<![CDATA[<MovMovimento>';
        cData += '<TMOV>';
        tagsTMOV.forEach(tag => { cData += tag; });
        cData += '</TMOV>';
        
        cData += '<TNFE>';
        tagsTNFE.forEach(tag => { cData += tag; });
        cData += '</TNFE>';
        
        cData += '<TMOVFISCAL>';
        tagsTMOVFISCAL.forEach(tag => { cData += tag; });
        cData += '</TMOVFISCAL>';
        
        cData += '<TMOVRATCCU>';
        tagsTMOVRATCCU.forEach(tag => { cData += tag; });
        cData += '</TMOVRATCCU>';
        
        cData += xmlContent;
        
        cData += '<TMOVCOMPL>';
        tagsTMOVCOMPL.forEach(tag => { cData += tag; });
        cData += '</TMOVCOMPL>';
        
        cData += '<TMOVTRANSP>';
        tagsTMOVTRANSP.forEach(tag => { cData += tag; });
        cData += '</TMOVTRANSP>';
        
        cData += '</MovMovimento>]]>';

        if (!cData) {
            throw new Error('Falha ao gerar XML de solicitação de compra');
        }

        console.info('[RM-INFO] CDATA gerado:', cData);

        // Chamada para o dataserver
        const contexto = `codusuario=p_heflo;codsistema=T;codcoligada=${CODCOLIGADA}`;
        let result = await dataServer.saveRecord(cData, 'MovMovimentoTBCData', contexto);

        if (!(result).includes('=')) {
            const SC = result.split(';')[1] || result;
            return formatResponse(201, { SC, message: 'Solicitação de compra criada com sucesso' });
        } else {
            const matchResult = result.match(/^[\s\S]*?(?=^=+)/m);
            if (!matchResult) {
                throw new Error('Falha ao extrair mensagem de erro do resultado');
            }
            const error = matchResult[0];
            const cleanError = error.replace(/&#xD;|\r|\n/g, ' ');

            const hasProduto = /produto/i.test(cleanError);
            const hasData = /data/i.test(cleanError);
            const hasMetta = /METTA/i.test(cleanError);
            const splitMessage = cleanError.split(':');

            let errorMessage;
            const mainErrorMatch = cleanError.match(/^(.*?)(?:=+|at RM\.|$)/s);
            if (mainErrorMatch && mainErrorMatch[1]) {
                errorMessage = mainErrorMatch[1].trim();
            } else if (hasProduto) {
                errorMessage = cleanError.trim();
            } else if (hasMetta) {
                const dateErrorMatch = cleanError.match(/METTA\d+\.\s*- (.*)/);
                errorMessage = dateErrorMatch ? dateErrorMatch[1].trim() : cleanError.trim();
            } else if (hasData) {
                const dateErrorMatch = cleanError.match(/:(.*?)[.]/);
                errorMessage = dateErrorMatch ? dateErrorMatch[1].trim() : cleanError.trim();
            } else if (splitMessage.length > 2) {
                errorMessage = splitMessage[1].trim() + ': ' + splitMessage[2].trim();
            } else {
                errorMessage = cleanError.includes(':') ? (cleanError.split(':')[1].trim()) : cleanError.trim();
            }

            console.warn('[RM-WARN] ', errorMessage);
            return formatResponse(400, { message: 'Erro ao criar solicitação de compra no TOTVS', error: "TOTVS: " + errorMessage });
        }
    } catch (error) {
        console.error('[RM-ERRO] ', error);
        return formatResponse(500, { message: 'Erro interno do servidor', error: "TICKET: " + (error instanceof Error ? error.message : String(error)) });
    }
};