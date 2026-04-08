import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classRm';
import { wsDataserver } from '../../../utils/wsDataserver';
import { montaXmlOC, montaXmlTitmmovrelac } from '../../../utils/xmlOrdemCompra';
import axios from 'axios';

const ConfigManagerRm = new CLASSES.ConfigManagerRm();
const dataserver = new wsDataserver();

function xmlEscape(value: any) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseRmSoapResult(rawXml: string) {
  const text = String(rawXml || '');
  const match = text.match(/<ExecuteWithXmlParamsResult[^>]*>([\s\S]*?)<\/ExecuteWithXmlParamsResult>/i);
  const resultText = match
    ? match[1].replace(/&#xD;|&#13;/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
    : text;
  return { success: resultText === '1', message: resultText };
}

function normalizeRmBaseUrl(input: string) {
  let base = String(input || '').trim();
  base = base.replace(/\/+$/, '');
  base = base.replace(/:\d+$/, '');
  return base;
}

// =============================================
// COLIGADA 1: CmpOrdemCompraProc (fluxo completo com TITMMOVRELAC + STSCOTACAO)
// =============================================
async function criarOC_ProcessServer(
  campos: any, CODCOLIGADA: string, CODFILIAL: string, ESTOQUE: string,
  CODTMVGERADO: string, itensValidos: any[]
) {
  const fornecedores = itensValidos.reduce((acc: Record<string, any[]>, item: { CODCFO: string }) => {
    acc[item.CODCFO] = acc[item.CODCFO] || [];
    acc[item.CODCFO].push(item);
    return acc;
  }, {});

  let listaDeProdutos = '';
  Object.keys(fornecedores).forEach((fornecedor) => {
    fornecedores[fornecedor].forEach((produto: any) => {
      listaDeProdutos += `
        <a:ProdutoInclusaoMov>
          <a:InternalId />
          <codCCusto>${xmlEscape(campos.codigoDoCentroDeCusto || '')}</codCCusto>
          <codCfo>${xmlEscape(produto.CODCFO)}</codCfo>
          <codColCfo>0</codColCfo>
          <codColMov>${xmlEscape(CODCOLIGADA)}</codColMov>
          <codCpgNegociada>${xmlEscape(produto.CODCPG || '')}</codCpgNegociada>
          <codDepartamento />
          <codFilial>${xmlEscape(CODFILIAL)}</codFilial>
          <codFilialEntrega>0</codFilialEntrega>
          <codLoc>${xmlEscape(ESTOQUE)}</codLoc>
          <codLocEntrega />
          <codMoeda>R$</codMoeda>
          <codRpr />
          <codTmvGerado>${xmlEscape(CODTMVGERADO)}</codTmvGerado>
          <codTraParadigma />
          <despesa>0</despesa>
          <freteCifOuFobParadigma>0</freteCifOuFobParadigma>
          <idClassMovGerado>0</idClassMovGerado>
          <idMov>${xmlEscape(produto.IDMOV)}</idMov>
          <idPrd>${xmlEscape(produto.IDPRD)}</idPrd>
          <movimento>0</movimento>
          <nSeqItmMov>${xmlEscape(produto.NSEQITMMOV)}</nSeqItmMov>
          <percDesconto>0</percDesconto>
          <percDespItmNeg>0</percDespItmNeg>
          <statusParadigma>N</statusParadigma>
          <valFreteParadigma>0</valFreteParadigma>
          <valorDesOcrc>0</valorDesOcrc>
        </a:ProdutoInclusaoMov>`;
    });
  });

  const envelope = `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
  <soapenv:Header />
  <soapenv:Body>
    <tot:ExecuteWithXmlParams>
      <tot:ProcessServerName>CmpOrdemCompraProc</tot:ProcessServerName>
      <tot:strXmlParams><![CDATA[
<CmpGerarOrdemCompraProcParams xmlns="http://www.totvs.com.br/RM/"
  xmlns:i="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:z="http://schemas.microsoft.com/2003/10/Serialization/">
  <Context xmlns="http://www.totvs.com/" xmlns:a="http://www.totvs.com.br/RM/">
    <a:_params xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODCOLIGADA</b:Key><b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODCOLIGADA}</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODFILIAL</b:Key><b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODFILIAL}</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUSUARIO</b:Key><b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">p_heflo</b:Value></b:KeyValueOfanyTypeanyType>
      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODSISTEMA</b:Key><b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">T</b:Value></b:KeyValueOfanyTypeanyType>
    </a:_params>
    <a:Environment>DotNet</a:Environment>
  </Context>
  <ListGerarOrdemCompra xmlns:a="http://www.totvs.com/">
    <a:CmpGerarOrdemCompraPar>
      <a:InternalId />
      <codColigada>${CODCOLIGADA}</codColigada>
      <codCotacao>${campos.cotacao}</codCotacao>
      <codFilial>${CODFILIAL}</codFilial>
      <codUsuario>p_heflo</codUsuario>
      <listProdutoAlteracao />
      <listProdutoInclusao>${listaDeProdutos}</listProdutoInclusao>
    </a:CmpGerarOrdemCompraPar>
  </ListGerarOrdemCompra>
</CmpGerarOrdemCompraProcParams>
      ]]></tot:strXmlParams>
    </tot:ExecuteWithXmlParams>
  </soapenv:Body>
</soapenv:Envelope>`.trim();

  const baseUrl = normalizeRmBaseUrl(ConfigManagerRm.getUrl());
  const response = await axios.post(`${baseUrl}:8051/wsProcess/IwsProcess`, envelope, {
    headers: {
      Authorization: `Basic ${ConfigManagerRm.getCredentials()}`,
      'Content-Type': 'text/xml; charset=utf-8',
      Accept: 'text/xml',
      SOAPAction: 'http://www.totvs.com/IwsProcess/ExecuteWithXmlParams'
    },
    timeout: 120000,
    validateStatus: () => true
  });

  console.log('[OC] CmpOrdemCompraProc HTTP:', response.status);
  const parsed = parseRmSoapResult(String(response.data || ''));
  console.log('[OC] CmpOrdemCompraProc resultado:', { success: parsed.success, msg: parsed.message.substring(0, 200) });

  if (response.status < 300 && parsed.success) {
    // Buscar IDMOVs vinculados a cotacao (exceto a SC) via TICKET.RAIZ.0012
    // Depois filtrar para pegar apenas OCs (CODTMV 1.1.05 ou 1.1.06)
    try {
      const candidatos = await ConfigManagerRm.consultaSQL(
        'TICKET.RAIZ.0012', 'T',
        `CODCOTACAO=${encodeURIComponent(campos.cotacao)};IDMOV=${campos.solicitacaoDeCompra}`
      );
      if (candidatos && Array.isArray(candidatos) && candidatos.length > 0) {
        const idmovs = candidatos.map((c: any) => String(c.IDMOV));
        // Verificar quais sao OCs lendo cada movimento
        const ocsEncontradas: string[] = [];
        for (const id of idmovs) {
          try {
            const ctx = `codusuario=p_heflo;codsistema=T;codcoligada=${CODCOLIGADA}`;
            const movXml = await dataserver.readReacord(`${CODCOLIGADA};${id}`, 'MovMovimentoTBCData', ctx);
            const movStr = String(movXml);
            if (movStr.includes('<SERIE>OC</SERIE>')) {
              ocsEncontradas.push(id);
            }
          } catch { /* ignora movimentos de outras coligadas */ }
        }
        if (ocsEncontradas.length > 0) {
          const OC = ocsEncontradas.join(' | ');
          console.log('[OC] OC obtida via TICKET.RAIZ.0012:', OC);
          return formatResponse(200, { OC });
        }
      }
    } catch (e: any) {
      console.warn('[OC] Falha ao buscar OC via TICKET.RAIZ.0012', e?.message?.substring(0, 200));
    }
    // Fallback: metodo antigo
    const OC = await ConfigManagerRm.getOC(
      String(CODCOLIGADA),
      String(campos.cotacao),
      String(campos.solicitacaoDeCompra)
    );
    return formatResponse(200, { OC });
  }

  const firstLine = (parsed.message || '').split(/\r?\n/)[0] || 'Erro retornado pelo RM';
  return formatResponse(400, { message: 'Erro retornado pelo RM (ProcessServer)', error: firstLine });
}

// =============================================
// COLIGADAS 2-30: MovMovimentoTBCData SaveRecord
// =============================================
async function criarOC_SaveRecord(
  campos: any, CODCOLIGADA: string, CODFILIAL: string, ESTOQUE: string,
  CODTMVGERADO: string, TIPO: string, itensValidos: any[], comprador: string
) {
  const porFornecedor: Record<string, any[]> = {};
  itensValidos.forEach((item) => {
    const cfo = item.CODCFO;
    if (!porFornecedor[cfo]) porFornecedor[cfo] = [];
    porFornecedor[cfo].push(item);
  });

  const fornecedores = Object.keys(porFornecedor);
  const resultados: Array<{ fornecedor: string; sucesso: boolean; idmov?: string; erro?: string }> = [];

  for (const codcfo of fornecedores) {
    const itensFornecedor = porFornecedor[codcfo];
    const primeiroItem = itensFornecedor[0];

    const xmlOC = montaXmlOC({
      codcoligada: CODCOLIGADA,
      codfilial: CODFILIAL,
      codtmv: CODTMVGERADO,
      tipo: TIPO,
      codcfo: codcfo,
      codcolcfo: String(primeiroItem.CODCOLCFO ?? '0'),
      codcpg: String(primeiroItem.CODCPG || primeiroItem.CODCPGNEGOCIADA || ''),
      codccusto: campos.codigoDoCentroDeCusto || '',
      codloc: ESTOQUE,
      codven1: comprador,
      historico: `OC gerada via integracao - Cotacao ${campos.cotacao}`,
      ticketRaiz: campos.ticketRaiz || '',
      itens: itensFornecedor.map((item: any) => ({
        IDPRD: item.IDPRD,
        QUANTIDADE: Number(item.QUANTIDADE || item.QUANTIDADEORC || 1),
        PRECOUNITARIO: Number(item.VALNEGOCIADO || item.VALCOTACAO || 0),
        CODCCUSTO: campos.codigoDoCentroDeCusto || '',
        CODLOC: ESTOQUE,
        CODVEN1: comprador,
        CODTBORCAMENTO: item.CODTBORCAMENTO || '',
        CODCOLTBORCAMENTO: item.CODCOLTBORCAMENTO || '0',
        CODUND: item.CODUND || item.CODUNDNEG || 'UN',
        IDMOVORIGEM: item.IDMOV || '',
        NSEQITMMOVORIGEM: item.NSEQITMMOV || '',
        CODCOLORIGEM: CODCOLIGADA,
      })),
    });

    const cdata = `<![CDATA[${xmlOC}]]>`;
    const contexto = `codusuario=p_heflo;codsistema=T;codcoligada=${CODCOLIGADA}`;

    console.log('[OC] SaveRecord para fornecedor', { codcfo, qtdItens: itensFornecedor.length, codcoligada: CODCOLIGADA, tipo: TIPO });

    try {
      const resultado = await dataserver.saveRecord(cdata, 'MovMovimentoTBCData', contexto);
      const resultStr = String(resultado).trim();

      console.log('[OC] SaveRecord retorno', { codcfo, resultado: resultStr.substring(0, 300) });

      const isErro = /obrigat|erro|exception|falha|invalid|não encontrad/i.test(resultStr);
      if (isErro) {
        const erroLinha = resultStr.split(/[\r\n]/)[0] || resultStr.substring(0, 200);
        console.error('[OC] SaveRecord ERRO RM', { codcfo, erro: erroLinha });
        resultados.push({ fornecedor: codcfo, sucesso: false, erro: erroLinha });
      } else {
        const partes = resultStr.split(';');
        const idmov = partes.length >= 2 ? partes[1] : resultStr;
        console.log('[OC] SaveRecord SUCESSO', { codcfo, idmov });
        resultados.push({ fornecedor: codcfo, sucesso: true, idmov });

        // Vinculo SC->OC via segundo SaveRecord (best-effort)
        try {
          const itensRelac = itensFornecedor.map((item: any, idx: number) => ({
            IDMOVORIGEM: item.IDMOV || '',
            NSEQITMMOVORIGEM: item.NSEQITMMOV || '',
            CODCOLORIGEM: CODCOLIGADA,
            NSEQITMMOVDESTINO: String(idx + 1),
            QUANTIDADE: Number(item.QUANTIDADE || item.QUANTIDADEORC || 1),
          }));
          const xmlRelac = montaXmlTitmmovrelac(CODCOLIGADA, idmov, itensRelac);
          const cdataRelac = `<![CDATA[${xmlRelac}]]>`;
          const contextoRelac = `codusuario=p_heflo;codsistema=T;codcoligada=${CODCOLIGADA}`;
          await dataserver.saveRecord(cdataRelac, 'MovMovimentoTBCData', contextoRelac);
          console.log('[OC] TITMMOVRELAC vinculado com sucesso', { codcfo, idmov });
        } catch (relacErr: any) {
          console.warn('[OC] TITMMOVRELAC falhou (nao bloqueia)', { codcfo, idmov, erro: (relacErr?.message || '').substring(0, 200) });
        }
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error('[OC] SaveRecord ERRO', { codcfo, erro: msg.substring(0, 500) });

      if (msg.includes('Status: 401') || msg.includes('Status: 403')) {
        return formatResponse(401, { message: 'Erro de autenticacao no RM', error: msg.split(/\r?\n/)[0] });
      }
      if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
        return formatResponse(504, { message: 'RM indisponivel ou timeout', error: msg.split(/\r?\n/)[0] });
      }
      resultados.push({ fornecedor: codcfo, sucesso: false, erro: msg.split(/\r?\n/)[0] });
    }
  }

  const sucessos = resultados.filter((r) => r.sucesso);
  const falhas = resultados.filter((r) => !r.sucesso);

  if (falhas.length === 0 && sucessos.length > 0) {
    const OC = sucessos.map((r) => r.idmov).join(' | ');
    return formatResponse(200, { OC });
  }
  if (sucessos.length === 0) {
    return formatResponse(400, { message: 'Erro ao gerar OC', error: falhas.map((r) => r.erro).join('; '), detalhes: falhas });
  }
  const OC = sucessos.map((r) => r.idmov).join(' | ');
  return formatResponse(200, { OC, avisos: falhas.map((r) => ({ fornecedor: r.fornecedor, erro: r.erro })) });
}

// =============================================
// HANDLER PRINCIPAL
// =============================================
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    console.log('[OC] Lambda iniciada', { isBase64: event.isBase64Encoded, hasBody: !!event.body });

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf-8')
      : (event.body || '{}');

    const campos = JSON.parse(rawBody);

    const CODCOLIGADA =
      campos.codigoDaColigada === '1'
        ? (campos.codigoDaColigada2 || '')
        : (campos.codigoDaColigada || '');

    const CODFILIAL =
      campos.codigoDaColigada === '1'
        ? (campos.codigoDaFilial2 || '')
        : (campos.codigoDaFilial || '');

    const ESTOQUE = await ConfigManagerRm.getLOC(CODCOLIGADA, CODFILIAL);

    const CODTMVGERADO = campos.tipoDeSolicitacao === 'P' ? '1.1.05' : '1.1.06';
    const TIPO = campos.tipoDeSolicitacao === 'P' ? 'P' : 'S';

    console.log('[OC] Contexto', { CODCOLIGADA, CODFILIAL, ESTOQUE, CODTMVGERADO, TIPO, cotacao: campos.cotacao });

    // ===============================
    // BUSCA GANHADOR
    // ===============================
    let listaDeItens: any[] = [];
    try {
      listaDeItens = await ConfigManagerRm.getGanhador(String(CODCOLIGADA), String(campos.cotacao));
    } catch (e) {
      console.error('[OC] Erro ao buscar ganhador', e);
      listaDeItens = [];
    }

    if (!Array.isArray(listaDeItens) || listaDeItens.length === 0) {
      return formatResponse(400, { message: 'Nenhum item vencedor retornado (getGanhador). Nao e possivel gerar OC.' });
    }

    const itensValidos = listaDeItens.filter((x) => {
      if (Number(x?.DECLINADO) === 1) return false;
      if (!x?.CODCFO || x?.IDMOV == null || x?.IDPRD == null || x?.NSEQITMMOV == null) return false;
      return true;
    });

    console.log('[OC] Itens validos:', { total: listaDeItens.length, validos: itensValidos.length });

    if (itensValidos.length === 0) {
      return formatResponse(400, { message: 'Nenhum item valido para gerar OC.' });
    }

    // ===============================
    // PROTECAO: Verificar se cotacao ja tem OC gerada
    // ===============================
    if (itensValidos[0]?.STSCOTACAO === '6') {
      return formatResponse(400, { message: 'Cotacao ja possui OC gerada (STSCOTACAO=6).', cotacao: campos.cotacao });
    }

    // ===============================
    // BUSCAR COMPRADOR: se nao veio no payload, buscar da SC original
    // ===============================
    let codigoDoComprador = campos.codigoDoComprador || '';
    if (!codigoDoComprador && CODCOLIGADA !== '1') {
      try {
        const idmovSC = String(itensValidos[0]?.IDMOV || campos.solicitacaoDeCompra || '');
        if (idmovSC) {
          const contextoSC = `codusuario=p_heflo;codsistema=T;codcoligada=${CODCOLIGADA}`;
          const scXml = await dataserver.readReacord(`${CODCOLIGADA};${idmovSC}`, 'MovMovimentoTBCData', contextoSC);
          const venMatch = String(scXml).match(/<CODVEN1>([^<]+)/);
          if (venMatch) {
            codigoDoComprador = venMatch[1];
            console.log('[OC] Comprador obtido da SC:', codigoDoComprador);
          }
        }
      } catch (e) {
        console.warn('[OC] Nao foi possivel buscar comprador da SC', e);
      }
    }

    // ===============================
    // DECISAO: Coligada 1 usa ProcessServer, demais usam SaveRecord
    // ===============================
    if (CODCOLIGADA === '1') {
      console.log('[OC] Coligada 1 -> CmpOrdemCompraProc (fluxo completo)');
      return await criarOC_ProcessServer(campos, CODCOLIGADA, CODFILIAL, ESTOQUE, CODTMVGERADO, itensValidos);
    } else {
      console.log('[OC] Coligada', CODCOLIGADA, '-> MovMovimentoTBCData SaveRecord');
      return await criarOC_SaveRecord(campos, CODCOLIGADA, CODFILIAL, ESTOQUE, CODTMVGERADO, TIPO, itensValidos, codigoDoComprador);
    }

  } catch (error: any) {
    console.error('[OC-LAMBDA-ERROR]', error);
    return formatResponse(500, { message: 'Internal Server Error', error: error?.message || String(error) });
  }
};