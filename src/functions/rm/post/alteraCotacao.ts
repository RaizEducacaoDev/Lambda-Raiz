

import * as wsDataserver from '../../../utils/wsDataserver';
var dataServer = new wsDataserver();

function toTotvsDecimal(value) {
    return value.toFixed(4).replace(".", ",");
}
function parsePtBrDecimal(value) {
    if (!value || value.trim() === "") return 0;
    return parseFloat(value.replace(/\./g, "").replace(",", ".")) || 0;
}
function parseDateBr(dateStr, horaStr) {
    if (!dateStr || !dateStr.trim()) return "";
    const parts = dateStr.trim().split("/");
    if (parts.length !== 3) return "";
    const [dia, mes, ano] = parts;
    return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}T${horaStr}`;
}
function addDaysToDateBr(dataBr, days, horaStr) {
    const parts = dataBr.split("/");
    if (parts.length !== 3) return parseDateBr(dataBr, horaStr);
    const [dia, mes, ano] = parts.map(Number);
    const date = new Date(ano, mes - 1, dia);
    date.setDate(date.getDate() + days);
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${date.getFullYear()}-${m}-${d}T${horaStr}`;
}
function getField(xml, field) {
    const m = xml.match(new RegExp(`<${field}>(.*?)</${field}>`, "s"));
    return m ? m[1] : "";
}
function getAllSections(xml, tagName) {
    const results = [];
    const re = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "gs");
    let m;
    while ((m = re.exec(xml)) !== null) {
        results.push(m[1]);
    }
    return results;
}
function xmlTag(field, value) {
    return `<${field}>${value}</${field}>`;
}
function buildTccotacao(inner) {
    const fields = [
        "CODCOTACAO",
        "CODCOLIGADA",
        "DATCOTACAO",
        "DATLIMRESPTA",
        "CODCOMPRADOR",
        "STSCOTACAO",
        "CODCPG",
        "DATENTREGA",
        "CODFILIAL",
        "CODMOEDA",
        "TIPOJULGAMENTO"
    ];
    const tags = fields.map((f) => {
        const v = getField(inner, f);
        return v !== "" ? xmlTag(f, v) : "";
    }).join("");
    return `<TCCOTACAO>${tags}</TCCOTACAO>`;
}
function buildTcorcamento(inner, orcForn, horaStr) {
    const fields = [
        "CODCOTACAO",
        "CODCOLIGADA",
        "CODCFO",
        "CODCOLCFO",
        "VALPRAZOENTREGA",
        "DATENTREGA",
        "DATAENTREGAORC",
        "VALPRAZOVALIDADE",
        "CODCPG",
        "CODCPGNEGOCIADA",
        "VALTRB",
        "VALFRETE",
        "FRETECIFOUFOB",
        "CODMOEDA",
        "DESPESA",
        "VALORFRETE",
        "FORMACOMUNICACAO",
        "VALORDESOCRC",
        "PERCDESCORC",
        "VALORDESCNEG",
        "PERCDESCNEG",
        "VALICMSST",
        "ALIQFIXADIFERENCIAL",
        "DECLINADO"
    ];
    const numericos = new Set([
        "VALTRB",
        "VALFRETE",
        "DESPESA",
        "VALORFRETE",
        "VALORDESOCRC",
        "PERCDESCORC",
        "VALORDESCNEG",
        "PERCDESCNEG",
        "VALICMSST"
    ]);
    const valfrete = orcForn ? parsePtBrDecimal(orcForn.VALORFRETE) : parseFloat(getField(inner, "VALFRETE")) || 0;
    const prazo = orcForn ? parseInt(orcForn.PRAZOENTREGA ?? "0") || 0 : 0;
    const datentrega = orcForn?.DATENTREGA ? parseDateBr(orcForn.DATENTREGA, horaStr) : getField(inner, "DATENTREGA");
    const dataentregaorc = orcForn?.DATENTREGA ? parseDateBr(orcForn.DATENTREGA, horaStr) : getField(inner, "DATAENTREGAORC");
    let xml = "<TCORCAMENTO>";
    fields.forEach((f) => {
        let value;
        switch (f) {
            case "VALFRETE":
            case "VALORFRETE":
                value = toTotvsDecimal(valfrete);
                break;
            case "VALPRAZOENTREGA":
                value = String(prazo);
                break;
            case "DATENTREGA":
                value = datentrega;
                break;
            case "DATAENTREGAORC":
                value = dataentregaorc;
                break;
            default: {
                const raw = getField(inner, f);
                if (raw === "") return;
                value = numericos.has(f) ? toTotvsDecimal(parseFloat(raw) || 0) : raw;
            }
        }
        if (value !== "") xml += xmlTag(f, value);
    });
    xml += "</TCORCAMENTO>";
    return xml;
}
function buildTcitmorcamento(inner, orc, dataCotacao, horaStr) {
    const fields = [
        "CODCOTACAO",
        "CODCOLIGADA",
        "CODCOLCFO",
        "CODCFO",
        "IDPRD",
        "IDMOV",
        "CODCOLMOV",
        "NSEQITMMOV",
        "QTDEFETIVADA",
        "VALCOTACAO",
        "VALNEGOCIADO",
        "CODUND",
        "VALTRB",
        "STSITEM",
        "CFOVENCEDOR",
        "VALTOTCOTACAO",
        "VALTOTCOTACAONEG",
        "DESCONTO",
        "PERCDESCONTO",
        "DESCONTONEGOCIADO",
        "PERCDESCONTONEGOCIADO",
        "CODCPG",
        "DATAENTREGA",
        "DESPESA",
        "CODCPGNEGOCIADA",
        "CODMOEDA",
        "VALORDESPITMORC",
        "VALORDESPITMNEG",
        "PERCDESPITMNEG",
        "PRAZOENTREGA",
        "PERCICMSITMORC",
        "VALICMSST",
        "MARGEMICMSST",
        "QUANTIDADEORC",
        "CODUNDORC",
        "QUANTIDADENEG",
        "CODUNDNEG"
    ];
    const numericos = new Set([
        "QTDEFETIVADA",
        "VALCOTACAO",
        "VALNEGOCIADO",
        "VALTRB",
        "VALTOTCOTACAO",
        "VALTOTCOTACAONEG",
        "DESCONTO",
        "PERCDESCONTO",
        "DESCONTONEGOCIADO",
        "PERCDESCONTONEGOCIADO",
        "DESPESA",
        "VALORDESPITMORC",
        "VALORDESPITMNEG",
        "PERCDESPITMNEG",
        "PERCICMSITMORC",
        "VALICMSST",
        "MARGEMICMSST",
        "QUANTIDADEORC",
        "QUANTIDADENEG"
    ]);
    let valCotacao = parseFloat(getField(inner, "VALCOTACAO")) || 0;
    let valNegociado = parseFloat(getField(inner, "VALNEGOCIADO")) || 0;
    let qtdOrc = parseFloat(getField(inner, "QUANTIDADEORC")) || 0;
    let qtdNeg = parseFloat(getField(inner, "QUANTIDADENEG")) || 0;
    let desconto = parseFloat(getField(inner, "DESCONTO")) || 0;
    let descontoNeg = parseFloat(getField(inner, "DESCONTONEGOCIADO")) || 0;
    let prazo = parseInt(getField(inner, "PRAZOENTREGA")) || -1;
    let dataEntrega = getField(inner, "DATAENTREGA");
    if (orc) {
        valCotacao = parsePtBrDecimal(orc.VALCOTACAO);
        valNegociado = valCotacao;
        qtdOrc = parseFloat(orc.QUANTIDADE) || qtdOrc;
        qtdNeg = qtdOrc;
        desconto = parsePtBrDecimal(orc.DESCONTO);
        descontoNeg = desconto;
        prazo = parseInt(orc.PRAZOENTREGA ?? "-1") || -1;
        if (prazo > 0) {
            dataEntrega = addDaysToDateBr(dataCotacao, prazo, horaStr);
        } else if (orc.DATENTREGA) {
            dataEntrega = parseDateBr(orc.DATENTREGA, horaStr);
        }
    }
    const valtotcotacao = valCotacao * qtdOrc;
    const valtotcotacaoneg = valNegociado * qtdNeg;
    let xml = "<TCITMORCAMENTO>";
    fields.forEach((f) => {
        let value;
        switch (f) {
            case "VALCOTACAO":
                value = toTotvsDecimal(valCotacao);
                break;
            case "VALNEGOCIADO":
                value = toTotvsDecimal(valNegociado);
                break;
            case "QUANTIDADEORC":
                value = toTotvsDecimal(qtdOrc);
                break;
            case "QUANTIDADENEG":
                value = toTotvsDecimal(qtdNeg);
                break;
            case "DESCONTO":
                value = toTotvsDecimal(desconto);
                break;
            case "DESCONTONEGOCIADO":
                value = toTotvsDecimal(descontoNeg);
                break;
            case "PRAZOENTREGA":
                value = String(prazo);
                break;
            case "DATAENTREGA":
                value = dataEntrega;
                break;
            case "VALTOTCOTACAO":
                value = toTotvsDecimal(valtotcotacao);
                break;
            case "VALTOTCOTACAONEG":
                value = toTotvsDecimal(valtotcotacaoneg);
                break;
            default: {
                const raw = getField(inner, f);
                if (raw === "") return;
                value = numericos.has(f) ? toTotvsDecimal(parseFloat(raw) || 0) : raw;
            }
        }
        if (value !== "") xml += xmlTag(f, value);
    });
    xml += "</TCITMORCAMENTO>";
    return xml;
}
var INSTANCE_ID = Math.random().toString(36).slice(2, 9);
var handler = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const data = Array.isArray(body) ? body[0] : body;
        const { CODCOTACAO, CODCOLIGADA, DATACOTACAO, HORACOTACAO, orcamentos } = data;
        if (!CODCOTACAO || !CODCOLIGADA || !orcamentos?.length) {
            return formatResponse(400, {
                message: "Campos obrigat\xF3rios ausentes: CODCOTACAO, CODCOLIGADA, orcamentos"
            });
        }
        console.log(`[alteraCotacao] Iniciando \u2014 CODCOTACAO: ${CODCOTACAO} | Or\xE7amentos: ${orcamentos.length}`);

        // --- LOG 1: payload recebido do Zeev ---
        console.log("[alteraCotacao] PAYLOAD RECEBIDO:", JSON.stringify({ CODCOTACAO, CODCOLIGADA, DATACOTACAO, HORACOTACAO, orcamentos }, null, 2));

        const contexto = `CODCOLIGADA=${CODCOLIGADA};CODSISTEMA=T;CODUSUARIO=p_heflo`;
        const primaryKey = `${CODCOTACAO};${CODCOLIGADA}`;
        const xmlAtual = await dataServer.readReacord(primaryKey, "CmpCotacaoData", contexto);
        const tccotacaoInner = xmlAtual.match(/<TCCOTACAO>(.*?)<\/TCCOTACAO>/s)?.[1] ?? "";
        const tcorcamentos = getAllSections(xmlAtual, "TCORCAMENTO");
        const tcitmorcamentos = getAllSections(xmlAtual, "TCITMORCAMENTO");
        if (!tccotacaoInner) {
            return formatResponse(404, { message: `Cota\xE7\xE3o ${CODCOTACAO} n\xE3o encontrada no TOTVS` });
        }

        // --- LOG 2: estado atual do TOTVS antes de qualquer alteração ---
        const estadoAntes = tcitmorcamentos.map((inner) => ({
            CODCFO: getField(inner, "CODCFO"),
            IDPRD: getField(inner, "IDPRD"),
            VALCOTACAO: getField(inner, "VALCOTACAO"),
            VALNEGOCIADO: getField(inner, "VALNEGOCIADO"),
            QUANTIDADEORC: getField(inner, "QUANTIDADEORC"),
            QUANTIDADENEG: getField(inner, "QUANTIDADENEG"),
            DESCONTO: getField(inner, "DESCONTO"),
            DESCONTONEGOCIADO: getField(inner, "DESCONTONEGOCIADO"),
            PRAZOENTREGA: getField(inner, "PRAZOENTREGA"),
            DATAENTREGA: getField(inner, "DATAENTREGA"),
            STSITEM: getField(inner, "STSITEM"),
            CFOVENCEDOR: getField(inner, "CFOVENCEDOR"),
        }));
        const freteAntes = tcorcamentos.map((inner) => ({
            CODCFO: getField(inner, "CODCFO"),
            VALFRETE: getField(inner, "VALFRETE"),
            VALORFRETE: getField(inner, "VALORFRETE"),
            DESPESA: getField(inner, "DESPESA"),
        }));
        console.log("[alteraCotacao] ESTADO ANTES (TCITMORCAMENTO):", JSON.stringify(estadoAntes, null, 2));
        console.log("[alteraCotacao] ESTADO ANTES (TCORCAMENTO - frete/despesa):", JSON.stringify(freteAntes, null, 2));

        const orcMap = new Map();
        orcamentos.forEach((o) => orcMap.set(`${o.CODCFO}|${o.IDPRD}`, o));
        const primeiroOrcPorForn = new Map();
        orcamentos.forEach((o) => {
            if (!primeiroOrcPorForn.has(o.CODCFO)) primeiroOrcPorForn.set(o.CODCFO, o);
        });

        let xmlBody = buildTccotacao(tccotacaoInner);
        tcorcamentos.forEach((inner) => {
            const codcfo = getField(inner, "CODCFO");
            const orcForn = primeiroOrcPorForn.get(codcfo);
            xmlBody += buildTcorcamento(inner, orcForn, HORACOTACAO);
        });

        // --- LOG 3: alterações aplicadas por item ---
        tcitmorcamentos.forEach((inner) => {
            const codcfo = getField(inner, "CODCFO");
            const idprd = getField(inner, "IDPRD");
            const orc = orcMap.get(`${codcfo}|${idprd}`);
            if (orc) {
                const alteracoes = {};
                if (orc.VALCOTACAO !== undefined && orc.VALCOTACAO !== getField(inner, "VALCOTACAO")) alteracoes.VALCOTACAO = { antes: getField(inner, "VALCOTACAO"), depois: orc.VALCOTACAO };
                if (orc.QUANTIDADE !== undefined && orc.QUANTIDADE !== getField(inner, "QUANTIDADEORC")) alteracoes.QUANTIDADE = { antes: getField(inner, "QUANTIDADEORC"), depois: orc.QUANTIDADE };
                if (orc.DESCONTO !== undefined && orc.DESCONTO !== getField(inner, "DESCONTO")) alteracoes.DESCONTO = { antes: getField(inner, "DESCONTO"), depois: orc.DESCONTO };
                if (orc.PRAZOENTREGA !== undefined && orc.PRAZOENTREGA !== getField(inner, "PRAZOENTREGA")) alteracoes.PRAZOENTREGA = { antes: getField(inner, "PRAZOENTREGA"), depois: orc.PRAZOENTREGA };
                if (orc.DATENTREGA !== undefined && orc.DATENTREGA !== getField(inner, "DATAENTREGA")) alteracoes.DATAENTREGA = { antes: getField(inner, "DATAENTREGA"), depois: orc.DATENTREGA };
                console.log(`[alteraCotacao] ALTERACAO CODCFO=${codcfo} IDPRD=${idprd}:`, JSON.stringify(alteracoes, null, 2));
            } else {
                console.log(`[alteraCotacao] SEM ALTERACAO (mantido do TOTVS) CODCFO=${codcfo} IDPRD=${idprd}`);
            }
            xmlBody += buildTcitmorcamento(inner, orc, DATACOTACAO, HORACOTACAO);
        });

        // --- LOG 4: XML final enviado ao TOTVS ---
        const cdata = `<![CDATA[<CmpCotacao>${xmlBody}</CmpCotacao>]]>`;
        console.log("[alteraCotacao] XML ENVIADO AO TOTVS (SaveRecord):", cdata);

        const resultado = await dataServer.saveRecord(cdata, "CmpCotacaoData", contexto);
        console.log(`[alteraCotacao] Resultado SaveRecord: ${resultado}`);
        if (typeof resultado === "string" && !String(resultado).includes(CODCOTACAO)) {
            const primeiraLinha = String(resultado).split("\n")[0].trim();
            return formatResponse(400, {
                message: "Erro ao gravar cota\xE7\xE3o no TOTVS",
                error: primeiraLinha
            });
        }
        return formatResponse(200, {
            message: "Cota\xE7\xE3o atualizada com sucesso",
            CODCOTACAO: resultado
        });
    } catch (error) {
        console.error("[RM-ERRO] Falha ao alterar cota\xE7\xE3o:", error);
        return formatResponse(500, {
            message: "Internal Server Error",
            error: error instanceof Error ? error.message : String(error)
        });
    }
};