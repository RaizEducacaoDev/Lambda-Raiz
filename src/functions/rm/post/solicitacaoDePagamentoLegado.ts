
import { formatResponse } from '../../../utils/response';
import { montaTag } from '../../../utils/xml';
import { wsDataserver } from '../../../utils/wsDataserver';
import { toISOSimple } from '../../../utils/date';
import * as CLASSES from '../../../utils/classRm';
const { parseStringPromise } = require("xml2js");

const dataServer = new wsDataserver();
const ConfigManagerRm = new CLASSES.ConfigManagerRm();

const obterTexto = (valor: any): string => {
  if (Array.isArray(valor)) return obterTexto(valor[0]);
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
};

const somenteDigitos = (valor: any): string => obterTexto(valor).replace(/\D/g, "");

const normalizarCodigoBarras = (valor: any): string => {
  const digitos = somenteDigitos(valor);

  if (digitos.length === 47) {
    return [
      digitos.slice(0, 4),
      digitos.slice(32, 33),
      digitos.slice(33, 47),
      digitos.slice(4, 9),
      digitos.slice(10, 20),
      digitos.slice(21, 31),
    ].join("");
  }

  if (digitos.length === 48) {
    return [
      digitos.slice(0, 11),
      digitos.slice(12, 23),
      digitos.slice(24, 35),
      digitos.slice(36, 47),
    ].join("");
  }

  return digitos;
};

const obterValorBoleto = (campos: any, parcela?: any): any => {
  const candidatos = [
    parcela?.codigoDeBarrasBoleto,
    parcela?.codigoDeBarras,
    parcela?.linhaDigitavelBoleto,
    parcela?.linhaDigitavel,
    campos.codigoDeBarrasBoleto,
    campos.codigoDeBarras,
    campos.linhaDigitavelBoleto,
    campos.linhaDigitavel,
  ];

  return candidatos.find((valor) => obterTexto(valor) !== "");
};

const obterDadosBoleto = (campos: any, parcela?: any) => {
  const valor = obterValorBoleto(campos, parcela);
  const ipte = somenteDigitos(valor);

  return {
    codigoBarras: normalizarCodigoBarras(valor),
    ipte: ipte.length === 47 || ipte.length === 48 ? ipte : "",
  };
};

const obterIdPgto = (campos: any, parcela?: any): number | undefined => {
  const candidatos = [
    parcela?.idpgto,
    parcela?.idPgto,
    campos.idpgto,
    campos.idPgto,
  ];

  const valorEncontrado = candidatos.find((valor) => obterTexto(valor) !== "");
  const texto = obterTexto(valorEncontrado);

  if (!texto) return undefined;

  const numero = Number(texto);
  return Number.isInteger(numero) ? numero : undefined;
};

const obterCodColPgto = (campos: any, parcela?: any): number | undefined => {
  const candidatos = [
    parcela?.CODCOLPGTO,
    parcela?.codcolpgto,
    parcela?.codColPgto,
    campos.CODCOLPGTO,
    campos.codcolpgto,
    campos.codColPgto,
  ];

  const valorEncontrado = candidatos.find((valor) => obterTexto(valor) !== "");
  const texto = obterTexto(valorEncontrado);

  if (!texto) return undefined;

  const numero = Number(texto);
  return Number.isInteger(numero) ? numero : undefined;
};

const comoArray = (valor: any): any[] => {
  if (!valor) return [];
  return Array.isArray(valor) ? valor : [valor];
};

const localizarObjeto = (obj: any, chave: string): any => {
  if (!obj || typeof obj !== "object") return null;
  if (obj[chave]) return Array.isArray(obj[chave]) ? obj[chave][0] : obj[chave];

  for (const valor of Object.values(obj)) {
    const encontrado = localizarObjeto(valor, chave);
    if (encontrado) return encontrado;
  }

  return null;
};

const aguardar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const handlerLegado = async (event: any, opcoesV2?: { transporte: Pick<wsDataserver, 'saveRecord'>; getLOC: (coligada: string, filial: string) => Promise<string> }) => {
  try {
    const campos = JSON.parse(event.body);
    console.info("[RM-INFO] Campos recebidos:", JSON.stringify(campos, null, 2));

    const CODCOLIGADA = campos.codigoDaColigada2 || campos.codigoDaColigada || "";
    const CODFILIAL = campos.codigoDaFilial2 || campos.codigoDaFilial || "";
    const PG = obterTexto(campos.idDoMovimento || campos.movimentoExistente);
    const contextoMovimento = `CODCOLIGADA=${CODCOLIGADA};CODUSUARIO=p_heflo`;
    const contextoFinanceiro = `CODSISTEMA=F;CODCOLIGADA=${CODCOLIGADA};CODUSUARIO=p_heflo`;
    const tipoChavePix = obterTexto(campos.codigoTipoChavePIX);
    const qrCodePix = tipoChavePix === "6" ? obterTexto(campos.chavePIX) : "";

    if (tipoChavePix === "6" && !qrCodePix) {
      return formatResponse(400, {
        message: "O campo chavePIX e obrigatorio para o tipo de chave PIX 6",
      });
    }

    if (qrCodePix.length > 500) {
      return formatResponse(400, {
        message: "O campo chavePIX excede o limite de 500 caracteres do TOTVS",
      });
    }

    const normalizarData = (valor: any): string => obterTexto(valor).split("T")[0];

    const resultadoComErroRm = (resultado: string): boolean => resultado.includes("=");

    const obterVencimentoEsperado = (index: number): string => {
      const parcelas = comoArray(campos.listaDeParcelas);
      const vencimentoParcela = obterTexto(parcelas[index]?.vencimentoDaParcela);
      const vencimento = vencimentoParcela || obterTexto(campos.dataDeVencimento);

      return vencimento ? toISOSimple(vencimento) : "";
    };

    const lerPagamentosMovimento = async (IDMOV: string): Promise<any[]> => {
      const movXml = await dataServer.readReacord(
        `${CODCOLIGADA};${IDMOV}`,
        "MovMovimentoTBCData",
        contextoMovimento
      );
      const movObj = await parseStringPromise(movXml, { explicitArray: false });

      return comoArray(movObj?.MovMovimento?.TMOVPAGTO);
    };

    const salvarVencimentoFinanceiro = async (idLan: string, novoVencimento: string): Promise<void> => {
      const tagsFlan = [
        ["CODCOLIGADA", CODCOLIGADA],
        ["IDLAN", idLan],
        ["DATAVENCIMENTO", novoVencimento],
        ["DATAPREVBAIXA", novoVencimento],
      ].map(([tag, valor]) => montaTag(tag as string, valor));

      const xmlFinal = `<![CDATA[<FinLAN><FLAN>${tagsFlan.join("")}</FLAN></FinLAN>]]>`;
      const resultadoLan = await dataServer.saveRecord(xmlFinal, "FinLanDataBR", contextoFinanceiro);

      if (resultadoComErroRm(resultadoLan)) {
        throw new Error(resultadoLan);
      }
    };

    const atualizarVencimentoMovimentoExistente = async (IDMOV: string): Promise<void> => {
      const parcelas = comoArray(campos.listaDeParcelas);
      const possuiVencimento = Boolean(
        obterTexto(campos.dataDeVencimento) ||
        parcelas.some((parcela) => obterTexto(parcela?.vencimentoDaParcela))
      );

      if (!IDMOV || !possuiVencimento) return;

      const pagamentos = (await lerPagamentosMovimento(IDMOV)).filter((pagamento) =>
        obterTexto(pagamento?.IDSEQPAGTO) || obterTexto(pagamento?.IDLAN)
      );

      if (pagamentos.length === 0) {
        console.warn(`[RM-WARN] Nenhum pagamento encontrado para validar vencimento. IDMOV=${IDMOV}`);
        return;
      }

      let totalAtualizado = 0;

      for (let index = 0; index < pagamentos.length; index++) {
        const pagamento = pagamentos[index];
        const novoVencimento = obterVencimentoEsperado(index);
        if (!novoVencimento) continue;

        const idLan = obterTexto(pagamento?.IDLAN);
        if (!idLan || idLan === "-1") {
          console.warn(`[RM-WARN] Pagamento sem IDLAN para atualizar vencimento financeiro. IDMOV=${IDMOV}`);
          continue;
        }

        const flanXml = await dataServer.readReacord(
          `${CODCOLIGADA};${idLan}`,
          "FinLanDataBR",
          contextoFinanceiro
        );
        const flanObj = await parseStringPromise(flanXml, { explicitArray: false });
        const flan = localizarObjeto(flanObj, "FLAN");
        const vencimentoFinanceiroAtual = obterTexto(flan?.DATAVENCIMENTO);
        const vencimentoFinanceiroDiferente = normalizarData(vencimentoFinanceiroAtual) !== normalizarData(novoVencimento);

        if (!vencimentoFinanceiroDiferente) continue;

        await salvarVencimentoFinanceiro(idLan, novoVencimento);

        totalAtualizado++;
        console.info(
          `[RM-INFO] Vencimento financeiro atualizado para IDMOV=${IDMOV}, IDLAN=${idLan}: ${novoVencimento}`
        );
      }

      if (totalAtualizado === 0) {
        console.info(`[RM-INFO] Vencimento financeiro do movimento ${IDMOV} ja estava atualizado.`);
      }
    };

    const atualizarCodigoBarrasFinanceiro = async (IDMOV: string): Promise<void> => {
      const parcelas = comoArray(campos.listaDeParcelas);
      const dadosPadrao = obterDadosBoleto(campos);
      const idPgtoPadrao = obterIdPgto(campos);
      const codColPgtoPadrao = obterCodColPgto(campos);
      const possuiIntegracaoBancaria = Boolean(
        qrCodePix ||
        dadosPadrao.codigoBarras ||
        idPgtoPadrao !== undefined ||
        codColPgtoPadrao !== undefined ||
        parcelas.some((parcela) => {
          const dadosBoletoParcela = obterDadosBoleto(campos, parcela);
          return Boolean(
            dadosBoletoParcela.codigoBarras ||
            obterIdPgto(campos, parcela) !== undefined ||
            obterCodColPgto(campos, parcela) !== undefined
          );
        })
      );

      if (!possuiIntegracaoBancaria) return;

      let pagamentos: any[] = [];

      for (const espera of [0, 1000, 2000, 3000]) {
        if (espera > 0) await aguardar(espera);

        const movXml = await dataServer.readReacord(
          `${CODCOLIGADA};${IDMOV}`,
          "MovMovimentoTBCData",
          contextoMovimento
        );
        const movObj = await parseStringPromise(movXml, { explicitArray: false });
        pagamentos = comoArray(movObj?.MovMovimento?.TMOVPAGTO)
          .filter((pagamento) => {
            const idLan = obterTexto(pagamento?.IDLAN);
            return idLan && idLan !== "-1";
          });

        if (pagamentos.length > 0) break;
      }

      if (pagamentos.length === 0) {
        console.warn(`[RM-WARN] Nenhum IDLAN encontrado para gravar integração bancária. IDMOV=${IDMOV}`);
        return;
      }

      for (let index = 0; index < pagamentos.length; index++) {
        const idLan = obterTexto(pagamentos[index]?.IDLAN);
        const dadosBoleto = obterDadosBoleto(campos, parcelas[index]) || dadosPadrao;
        const codigoBarras = dadosBoleto.codigoBarras || dadosPadrao.codigoBarras;
        const ipte = dadosBoleto.ipte || dadosPadrao.ipte;
        const idPgto = obterIdPgto(campos, parcelas[index]) ?? idPgtoPadrao;
        const codColPgto = obterCodColPgto(campos, parcelas[index]) ?? codColPgtoPadrao;

        if (!qrCodePix && !codigoBarras && idPgto === undefined && codColPgto === undefined) {
          console.warn(`[RM-WARN] Dados bancários vazios para IDLAN=${idLan}`);
          continue;
        }

        const salvarLancamento = async (incluirIpte: boolean): Promise<void> => {
          const tagsFlan = [
            ["CODCOLIGADA", CODCOLIGADA],
            ["IDLAN", idLan],
            ...(codColPgto !== undefined ? [["CODCOLPGTO", String(codColPgto)]] : []),
            ...(idPgto !== undefined ? [["IDPGTO", String(idPgto)]] : []),
            ...(codigoBarras ? [["CODIGOBARRA", codigoBarras]] : []),
            ...(incluirIpte && ipte ? [["IPTE", ipte]] : []),
            ...(qrCodePix ? [["QRCODEPIX", qrCodePix]] : []),
          ].map(([tag, valor]) => montaTag(tag as string, valor));

          const xmlFinal = `<![CDATA[<FinLAN><FLAN>${tagsFlan.join("")}</FLAN></FinLAN>]]>`;
          const resultadoLan = await dataServer.saveRecord(xmlFinal, "FinLanDataBR", contextoFinanceiro);

          if (resultadoLan.includes("=")) {
            throw new Error(resultadoLan);
          }
        };

        try {
          await salvarLancamento(Boolean(ipte));
        } catch (erroLancamento) {
          const mensagem = erroLancamento instanceof Error ? erroLancamento.message : String(erroLancamento);
          if (!ipte || !/IPTE|Linha Digit/i.test(mensagem)) {
            throw new Error(`Falha ao gravar integração bancária no lançamento ${idLan}: ${mensagem}`);
          }

          console.warn(`[RM-WARN] IPTE inválido para IDLAN=${idLan}; tentando gravar somente CODIGOBARRA.`);
          await salvarLancamento(false);
        }

        console.info(`[RM-INFO] Integração bancária gravada no lançamento financeiro IDLAN=${idLan}`);
      }
    };

    const tentarAtualizarCodigoBarrasFinanceiro = async (IDMOV: string): Promise<void> => {
      if (opcoesV2) return; // V2 confirma os dados pelo seu próprio protocolo durável.
      try {
        await atualizarCodigoBarrasFinanceiro(IDMOV);
      } catch (erroCodigoBarras) {
        console.error("[RM-ERRO] Movimento gravado, mas falhou ao gravar integração bancária no financeiro:", erroCodigoBarras);
      }
    };

    if (PG && campos.atividadeAtual != "validarPrestacaoContas") {
      await atualizarVencimentoMovimentoExistente(PG);
      if (qrCodePix) {
        await tentarAtualizarCodigoBarrasFinanceiro(PG);
      }
      return formatResponse(200, { PG });
    }

    const ESTOQUE = opcoesV2 ? await opcoesV2.getLOC(CODCOLIGADA, CODFILIAL) : await ConfigManagerRm.getLOC(CODCOLIGADA, CODFILIAL);

    const contasDeConsumoRecebida = campos.contasDeConsumo || "";
    const contaDeConsumoNormalizada = obterTexto(contasDeConsumoRecebida).toUpperCase();
    const contasDeConsumo = ["I", "INTERNET"].includes(contaDeConsumoNormalizada)
      ? "T"
      : contasDeConsumoRecebida;

    const codigos = {
      AD: "1.2.06",
      RE: "1.2.07",
      FF: "1.2.29",
      RFF: "1.2.28",
      PG: {
        TM: "1.2.25",
        CC: { A: "1.2.09", E: "1.2.10", T: "1.2.11", G: "1.2.12" },
        NF: { Material: "1.2.01", Serviço: "1.2.03" },
        OG: {
          FR: "1.2.16",
          AL: { PJ: "1.2.17", PF: "1.2.08" },
        },
      },
    } as Record<string, any>;

    const obterCodigoMovimento = (): string => {
      const tipoDaSolicitacao = campos.tipoDaSolicitacao || "";
      const tipoDoPagamento = campos.tipoDoPagamento || "";
      const tipoDeItem = campos.tipoDeItem || "";
      const outrosGastos = campos.outrosGastos || "";
      const tipoDoLocador = campos.tipoDoLocador || "";
      const atividadeAtual = campos.atividadeAtual || "";

      if (!tipoDaSolicitacao) {
        throw new Error("O tipo da solicitação é obrigatório");
      }

      if (atividadeAtual === "validarPrestacaoContas") {
        if (tipoDaSolicitacao === "AD" && tipoDeItem) {
          const codigo = codigos.PG.NF[tipoDeItem];
          if (codigo) return codigo;
        }
        if (tipoDaSolicitacao === "FF") {
          const codigo = codigos.RFF;
          if (codigo) return codigo;
        }
      }

      if (tipoDaSolicitacao !== "PG") {
        const codigo = codigos[tipoDaSolicitacao];
        if (!codigo) {
          throw new Error(`Tipo da solicitação é inválido: "${tipoDaSolicitacao}"`);
        }
        return codigo;
      }

      const tiposDePagamento: Record<string, () => string> = {
        TM: () => codigos.PG.TM,
        CC: () => {
          if (!contasDeConsumo) {
            throw new Error('Tipo da conta é obrigatório para pagamentos do tipo "CONTA DE CONSUMO"');
          }
          const codigo = codigos.PG.CC[contasDeConsumo];
          if (!codigo) throw new Error(`Conta de consumo inválida: "${contasDeConsumo}"`);
          return codigo;
        },
        NF: () => {
          if (!tipoDeItem) {
            throw new Error('Tipo de item é obrigatório para pagamentos do tipo "NOTA FISCAL"');
          }
          const codigo = codigos.PG.NF[tipoDeItem];
          if (!codigo) throw new Error(`Tipo de item é inválido: "${tipoDeItem}"`);
          return codigo;
        },
        padrao: () => {
          if (outrosGastos === "FR") return codigos.PG.OG.FR;
          if (!tipoDoLocador) {
            throw new Error('Tipo do locador é obrigatório para pagamentos do tipo "ALUGUEL"');
          }
          const codigo = codigos.PG.OG.AL[tipoDoLocador];
          if (!codigo) throw new Error(`Tipo do locador é inválido: "${tipoDoLocador}"`);
          return codigo;
        },
      };

      const resolverTipo = tiposDePagamento[tipoDoPagamento] || tiposDePagamento.padrao;
      return resolverTipo();
    };

    const CODTMV = obterCodigoMovimento();
    const diagnosticoMovimento = {
      ticket: campos.ticketRaiz,
      coligada: CODCOLIGADA,
      filial: CODFILIAL,
      codTmv: CODTMV,
    };

    const construirSecaoXML = (tag: string, conteudo: string[]): string =>
      `<${tag}>${conteudo.join("")}</${tag}>`;

    const isMovimentoSimples = ["1.2.06", "1.2.07", "1.2.29"].includes(CODTMV);
    const isMovimentoComFrete = ["1.2.01", "1.2.25"].includes(CODTMV);
    const isMovimentoComTributo = ["1.2.03"].includes(CODTMV);
    const isMovimentoComMunicipio = [
      "1.949.02", "2.949.02", "1.949.03", "2.949.03",
      "1.949.04", "2.949.04", "1.949.05", "2.949.05",
      "1.949.06", "2.949.06", "1.949.07", "2.949.07",
      "1.949.08", "2.949.08", "1.949.09", "2.949.09",
      "1.949.10", "2.949.10", "1.949.11", "2.949.11",
      "1.949.12", "2.949.12", "1.949.13", "2.949.13",
      "1.949.14", "2.949.14", "1.949.15", "2.949.15",
      "1.949.16", "2.949.16", "1.949.17", "2.949.17",
      "1.949.18", "2.949.18", "1.949.19", "2.949.19",
      "1.949.20", "2.949.20", "1.949.21", "2.949.21",
      "1.949.22", "2.949.22",
    ].includes(campos.codigoDaNaturezaFiscal);

    const tagIf = (cond: boolean, tag: [string, any]): [string, any][] => (cond ? [tag] : []);

    const tagsMovimento = [
      ["CODCOLIGADA", CODCOLIGADA],
      ["IDMOV", "-1"],
      ["CODFILIAL", CODFILIAL],
      ["CODLOC", ESTOQUE],
      ["CODCFO", campos.codigoDoFornecedor],
      ...tagIf(!isMovimentoSimples, ["NUMEROMOV", campos.numeroDaNF.slice(0, 9)]),
      ...tagIf(isMovimentoComFrete, ["SERIE", campos.serie]),
      ["CODTMV", CODTMV],
      ["DATAEMISSAO", ["1.2.06", "1.2.07", "1.2.29", "1.2.28"].includes(CODTMV)
        ? toISOSimple(campos.dataDeEntrada)
        : toISOSimple(campos.dataDeEmissao)],
      ["DATASAIDA", toISOSimple(campos.dataDeEntrada)],
      ...tagIf(isMovimentoComFrete, ["CHAVEACESSONFE", campos.chaveDeAcesso.replace(/\s+/g, "")]),
      ["CODCPG", campos.codigoDaFormaPagamento ? campos.codigoDaFormaPagamento : "001"],
      ["VALORLIQUIDO", campos.valorTotal],
      ...tagIf(isMovimentoComFrete, ["FRETECIFOUFOB", campos.tipoDeFrete]),
      ...tagIf(isMovimentoComFrete, ["VALORFRETE", campos.valorDoFrete === "9" || !campos.valorDoFrete ? "0" : campos.valorDoFrete]),
      ...tagIf(CODTMV === "1.2.01", ["VALORDESP", campos.outrasDespesas]),
      ...tagIf(CODTMV === "1.2.03", ["VALOREXTRA1", campos.outrasDespesas]),
      ...tagIf(isMovimentoComTributo, ["IDNAT", campos.idDaNaturezaFiscal]),
      ...tagIf(isMovimentoComTributo, ["CODIGOIRRF", campos.tributosCodigoDaReceita]),
      ...tagIf(isMovimentoComMunicipio, ["CODETDMUNSERV", campos.codigoDoEstado]),
      ...tagIf(isMovimentoComMunicipio, ["CODMUNSERVICO", campos.codigoDoMunicipio]),
      ["CODCCUSTO", campos.codigoDoCentroDeCusto],
      ["CODCOLCFO", "0"],
      ["HISTORICOCURTO", campos.informacoes],
    ].map(([tag, valor]) => montaTag(tag as string, valor));

    const itens: any[] = [];

    const configuracoesItem: Record<string, { natureza: string; codigo: string }> = {
      "1.2.06": { natureza: "02.23.00001", codigo: "8" },
      "1.2.09": { natureza: "02.07.00048", codigo: "17" },
      "1.2.10": { natureza: "02.07.00047", codigo: "7575" },
      "1.2.11": { natureza: "02.07.00051", codigo: "5251" },
      "1.2.12": { natureza: "02.07.00055", codigo: "5563" },
      // "1.2.25": { natureza: "02.07.00072", codigo: "116181" },
      "1.2.28": { natureza: "02.08.00021", codigo: "7143" },
    };

    if (configuracoesItem[CODTMV]) {
      const config = configuracoesItem[CODTMV];
      itens.push({
        codigoDaNatureza: config.natureza,
        coligadaDaNatureza: "0",
        codigoDoItem: config.codigo,
        qtdDoItem: "1",
        valorDoItem: campos.valorTotal,
        desconto: "0",
      });
    } else if (CODTMV === "1.2.08" || CODTMV === "1.2.17") {
      itens.push({
        codigoDaNatureza: "02.09.00001",
        coligadaDaNatureza: "0",
        codigoDoItem: "113849",
        qtdDoItem: "1",
        valorDoItem: campos.valorDoAluguel,
        desconto: "0",
      });

      const taxasAdicionais = [
        { natureza: "02.09.00002", codigo: "11", valor: "valorDoIPTU" },
        { natureza: "02.09.00006", codigo: "5659", valor: "valorDoCondominio" },
        { natureza: "02.09.00004", codigo: "5709", valor: "valorTaxaDeIncendio" },
        { natureza: "02.07.00047", codigo: "7575", valor: "valorContaDeEnergia" },
        { natureza: "02.07.00048", codigo: "17", valor: "valorContaDeAgua" },
        { natureza: "02.07.00055", codigo: "5563", valor: "ValorContaDeGas" },
      ];

      taxasAdicionais.forEach((taxa) => {
        const valor = campos[taxa.valor];
        const valorNumerico = parseFloat(valor.replace(/\./g, "").replace(",", "."));
        if (valorNumerico > 0) {
          itens.push({
            codigoDaNatureza: taxa.natureza,
            coligadaDaNatureza: "0",
            codigoDoItem: taxa.codigo,
            qtdDoItem: "1",
            valorDoItem: valor,
            desconto: "0",
          });
        }
      });
    } else {
      itens.push(...campos.itens);
    }

    const tagsItemMovimento =
      itens
        ?.map((item, index) => {
          const itemTags = [
            ["CODCOLIGADA", CODCOLIGADA],
            ["IDMOV", "-1"],
            ["NSEQITMMOV", (index + 1).toString()],
            ["IDPRD", item.codigoDoItem],
            ["QUANTIDADE", item.qtdDoItem],
            ["PRECOUNITARIO", item.valorDoItem],
            ["VALORDESC", item.desconto],
            ["CODCOLTBORCAMENTO", item.coligadaDaNatureza ? item.coligadaDaNatureza : "0"],
            ["CODTBORCAMENTO", item.codigoDaNatureza],
          ].map(([tag, valor]) => montaTag(tag as string, valor));
          return construirSecaoXML("TITMMOV", itemTags);
        })
        .join("") || "";

    const tagsComplementoMovimento = [
      ["CODCOLIGADA", CODCOLIGADA],
      ["IDMOV", "-1"],
      ["TICKET", campos.ticketRaiz],
      ["LINKDOCUMENTO", (campos.linkDaSolicitacao || "").slice(0, 255)],
      ...tagIf(CODTMV === "1.2.25", ["REMETENTE", (campos.remetente || "").replace(/\s+/g, "")]),
      ...tagIf(CODTMV === "1.2.25", ["INICIOPRESTACAO", (campos.inicioDaPrestacao || "").replace(/\s+/g, "")]),
      ...tagIf(CODTMV === "1.2.25", ["DESTINATARIO", (campos.destinatario || "").replace(/\s+/g, "")]),
      ...tagIf(CODTMV === "1.2.25", ["TERMINOPRESTACAO", (campos.terminoDaPrestacao || "").replace(/\s+/g, "")]),
    ].map(([tag, valor]) => montaTag(tag as string, valor));

    const construirSecaoTributos = campos.tributos
      .map((_tributo: any) => {
        const tributo = _tributo;
        const tags = [
          ["CODCOLIGADA", CODCOLIGADA],
          ["IDMOV", "-1"],
          ["NSEQITMMOV", "1"],
          ["CODTRB", tributo.codigoDoTributo],
          ["CODTRBBASE", tributo.codigoDoTributo],
          ["BASEDECALCULO", tributo.baseDeCalculo],
          ["ALIQUOTA", tributo.aliquota],
          ["VALOR", tributo.valorDaAliquota],
          ["EDITADO", "1"],
        ]
          .map(([tag, valor]) => montaTag(tag as string, valor))
          .join("");
        return `<TTRBITMMOV>${tags}</TTRBITMMOV>`;
      })
      .join("");

    const construirSecaoPagamento = (): string => {
      const tagsDadosPagamento = [
        ["CODCOLIGADA", CODCOLIGADA],
        ["IDMOV", "-1"],
        ["IDSEQPAGTO", "-1"],
        ["TIPOPIX", campos.codigoTipoDaChavePix],
        ["CHAVE", campos.chavePix],
        ["NOMEAGENCIA", campos.Banco],
        ["CODIGOAGENCIA", campos.Agencia],
        ["DIGITOAGENCIA", campos.digitoAgencia],
        ["CONTACORRENTE", campos.Conta],
        ["DIGITOCONTA", campos.digitoConta],
      ].map(([tag, valor]) => montaTag(tag as string, valor));

      const secaoDadosPagamento = construirSecaoXML("TDADOSPGTO", tagsDadosPagamento);

      if (
        Array.isArray(campos.listaDeParcelas) &&
        campos.listaDeParcelas.length > 0 &&
        campos.listaDeParcelas.every(
          (parcela: any) => parcela.valorDaParcela && parcela.vencimentoDaParcela
        )
      ) {
        return campos.listaDeParcelas
          .map((parcela: any) => {
            const tagsParcela = [
              ["CODCOLIGADA", CODCOLIGADA],
              ["IDMOV", "-1"],
              ["IDSEQPAGTO", "-1"],
              ["IDLAN", "-1"],
              ["DATAVENCIMENTO", toISOSimple(parcela.vencimentoDaParcela)],
              ["VALOR", parcela.valorDaParcela],
              ["CODIGOBARRA", obterDadosBoleto(campos, parcela).codigoBarras],
            ].map(([tag, valor]) => montaTag(tag as string, valor));
            return construirSecaoXML("TMOVPAGTO", [...tagsParcela, secaoDadosPagamento]);
          })
          .join("");
      }

      const tagsMovimentoPagamento = [
        ["CODCOLIGADA", CODCOLIGADA],
        ["IDMOV", "-1"],
        ["IDSEQPAGTO", "-1"],
        ["IDLAN", "-1"],
        ...tagIf(CODTMV === "1.2.29", ["IDFORMAPAGTO", "2"]),
        ["DATAVENCIMENTO", toISOSimple(campos.dataDeVencimento)],
        ["VALOR", campos.valorTotal],
        ["CODIGOBARRA", obterDadosBoleto(campos).codigoBarras],
      ].map(([tag, valor]) => montaTag(tag as string, valor));

      return construirSecaoXML("TMOVPAGTO", [...tagsMovimentoPagamento, secaoDadosPagamento]);
    };

    let cData = "<![CDATA[<MovMovimento>";
    cData += "<TMOV>";
    tagsMovimento.forEach((tag) => { cData += tag; });
    cData += "</TMOV>";
    cData += construirSecaoPagamento();
    cData += tagsItemMovimento;
    if (isMovimentoComTributo) {
      cData += construirSecaoTributos;
    }
    cData += "<TMOVCOMPL>";
    tagsComplementoMovimento.forEach((tag) => { cData += tag; });
    cData += "</TMOVCOMPL>";
    cData += "</MovMovimento>]]>";

    if (!cData) {
      throw new Error("Falha ao gerar XML de movimento");
    }

    let result: string;
    const inicioSaveRecord = Date.now();
    console.info("[RM-DIAG]", JSON.stringify({ ...diagnosticoMovimento, etapa: "SaveRecord", evento: "inicio" }));
    try {
      result = await (opcoesV2?.transporte || dataServer).saveRecord(cData, "MovMovimentoTBCData", `CODCOLIGADA=${CODCOLIGADA};CODUSUARIO=p_heflo`);
      console.info("[RM-DIAG]", JSON.stringify({
        ...diagnosticoMovimento,
        etapa: "SaveRecord",
        evento: "retorno",
        resultado: result.includes("=") ? "rejeicaoRm" : "sucesso",
        duracaoMs: Date.now() - inicioSaveRecord,
      }));
    } catch (errSoap) {
      if (opcoesV2) throw errSoap; // Resultado incerto permanece reservado na V2.
      const isConnReset = errSoap instanceof Error && errSoap.message.includes("socket hang up");
      console.info("[RM-DIAG]", JSON.stringify({
        ...diagnosticoMovimento,
        etapa: "SaveRecord",
        evento: "erro",
        codigo: isConnReset ? "ECONNRESET" : "ERRO_SOAP",
        duracaoMs: Date.now() - inicioSaveRecord,
      }));
      if (!isConnReset) throw errSoap;

      const esperas = [2000, 3000, 3000];

      let idMovExistente: string | null = null;
      let tentativa = 0;
      for (const espera of esperas) {
        tentativa++;
        await new Promise((r) => setTimeout(r, espera));
        const inicioConsulta = Date.now();
        idMovExistente = await ConfigManagerRm.getIdMovPorTicket(
          CODCOLIGADA,
          campos.ticketRaiz,
          CODTMV
        );
        console.info("[RM-DIAG]", JSON.stringify({
          ...diagnosticoMovimento,
          etapa: "consultaIdMov",
          tentativa,
          idMovRetornado: Boolean(idMovExistente),
          duracaoMs: Date.now() - inicioConsulta,
        }));
        if (idMovExistente) break;
        console.warn(`[RM-WARN] ECONNRESET lookup vazio, aguardando próxima tentativa...`);
      }

      if (idMovExistente) {
        console.info("[RM-DIAG]", JSON.stringify({ ...diagnosticoMovimento, etapa: "movimento", resultado: "recuperado", idMov: idMovExistente }));
        console.info(`[RM-INFO] ECONNRESET recuperado: IDMOV=${idMovExistente}`);
        await tentarAtualizarCodigoBarrasFinanceiro(idMovExistente);
        return formatResponse(200, { PG: idMovExistente });
      }

      console.info("[RM-DIAG]", JSON.stringify({ ...diagnosticoMovimento, etapa: "execucao", resultado: "erroSemMovimentoConfirmado" }));
      throw errSoap;
    }

    if (!result.includes("=")) {
      let PG2 = result.split(";")[1];
      console.info("[RM-DIAG]", JSON.stringify({ ...diagnosticoMovimento, etapa: "movimento", resultado: "gravado", idMov: PG2 }));
      await tentarAtualizarCodigoBarrasFinanceiro(PG2);
      return formatResponse(200, { PG: PG2 });
    } else {
      const matchResult = result.match(/^[\s\S]*?(?=^=+)/m);
      if (!matchResult) {
        throw new Error("Falha ao extrair mensagem de erro do resultado");
      }
      const error = matchResult[0];
      const cleanError = error.replace(/&#xD;|\r|\n/g, " ");

      const hasProduto = /produto/i.test(cleanError);
      const hasData = /data/i.test(cleanError);
      const hasMetta = /data/i.test(cleanError);
      const splitMessage = cleanError.split(":");

      let errorMessage: string;

      const mainErrorMatch = cleanError.match(/^(.*?)(?:=+|at RM\.|$)/s);
      if (mainErrorMatch && mainErrorMatch[1]) {
        errorMessage = mainErrorMatch[1].trim();
      } else if (hasProduto) {
        errorMessage = cleanError.trim();
      } else if (hasMetta) {
        const dateErrorMatch = cleanError.match(/METTA240\.\s*- (.*)/);
        errorMessage = dateErrorMatch ? dateErrorMatch[1].trim() : cleanError.trim();
      } else if (hasData) {
        const dateErrorMatch = cleanError.match(/:(.*?)[.]/);
        errorMessage = dateErrorMatch ? dateErrorMatch[1].trim() : cleanError.trim();
      } else if (splitMessage.length > 2) {
        errorMessage = splitMessage[1].trim() + ": " + splitMessage[2].trim();
      } else {
        errorMessage = cleanError.includes(":")
          ? cleanError.split(":")[1].trim()
          : cleanError.trim();
      }

      console.warn("[RM-WARN] ", errorMessage);
      return formatResponse(400, { message: "Erro ao gravar no TOTVS", error: "TOTVS: " + errorMessage });
    }
  } catch (error) {
    console.error("[RM-ERRO] ", error);
    return formatResponse(500, {
      message: "Erro interno do servidor",
      error: "TICKET: " + (error instanceof Error ? error.message : String(error)),
    });
  }
};
