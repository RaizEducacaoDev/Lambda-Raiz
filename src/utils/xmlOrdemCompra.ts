import { montaTag } from './xml';

export interface ItemOC {
  IDPRD: string | number;
  QUANTIDADE: number;
  PRECOUNITARIO: number;
  CODCCUSTO: string;
  CODLOC: string;
  CODVEN1?: string;
  CODTBORCAMENTO?: string;
  CODCOLTBORCAMENTO?: string;
  CODUND?: string;
  IDMOVORIGEM?: string | number;
  NSEQITMMOVORIGEM?: string | number;
  CODCOLORIGEM?: string;
}

export interface ParamsOC {
  codcoligada: string;
  codfilial: string;
  codtmv: string;
  tipo: string;
  codcfo: string;
  codcolcfo: string;
  codcpg: string;
  codccusto: string;
  codloc: string;
  codven1?: string;
  historico?: string;
  ticketRaiz?: string;
  itens: ItemOC[];
}

export function montaXmlOC(p: ParamsOC): string {
  const dataHoje = new Date().toISOString().split('T')[0] + 'T00:00:00';

  let xml = '<MovMovimento>';

  // === TMOV ===
  xml += '<TMOV>';
  xml += montaTag('CODCOLIGADA', p.codcoligada);
  xml += montaTag('IDMOV', '-1');
  xml += montaTag('CODFILIAL', p.codfilial);
  xml += montaTag('CODLOC', p.codloc);
  xml += montaTag('NUMEROMOV', '-1');
  xml += montaTag('SERIE', 'OC');
  xml += montaTag('CODTMV', p.codtmv);
  xml += montaTag('TIPO', p.tipo);
  xml += montaTag('STATUS', 'A');
  xml += montaTag('CODCFO', p.codcfo);
  xml += montaTag('CODCOLCFO', p.codcolcfo);
  xml += montaTag('CODCPG', p.codcpg);
  xml += montaTag('DATAEMISSAO', dataHoje);
  xml += montaTag('VALORBRUTO', '0.0000');
  xml += montaTag('VALORLIQUIDO', '0.0000');
  xml += montaTag('VALOROUTROS', '0.0000');
  xml += montaTag('CODMOEVALORLIQUIDO', 'R$');
  xml += montaTag('CODCCUSTO', p.codccusto);
  xml += montaTag('CODCFOAUX', p.codcfo);
  xml += montaTag('CODCOLCFOAUX', p.codcolcfo);
  if (p.codven1) xml += montaTag('CODVEN1', p.codven1);
  xml += montaTag('CODUSUARIO', 'p_heflo');
  xml += montaTag('USUARIOCRIACAO', 'p_heflo');
  xml += montaTag('CODFILIALDESTINO', p.codfilial);
  xml += montaTag('MOVIMPRESSO', '0');
  xml += montaTag('DOCIMPRESSO', '0');
  xml += montaTag('FATIMPRESSA', '0');
  xml += montaTag('COMISSAOREPRES', '0.0000');
  xml += montaTag('PERCCOMISSAO', '0.0000');
  xml += montaTag('CODMEN', '01');
  xml += montaTag('PESOLIQUIDO', '0.0000');
  xml += montaTag('PESOBRUTO', '0.0000');
  xml += montaTag('GEROUFATURA', '0');
  xml += montaTag('GERADOPORLOTE', '0');
  xml += montaTag('STATUSEXPORTCONT', '0');
  xml += montaTag('FLAGPROCESSADO', '0');
  xml += montaTag('INTEGRAAPLICACAO', 'T');
  xml += montaTag('STATUSPARADIGMA', 'N');
  xml += montaTag('STATUSINTEGRACAO', 'N');
  xml += montaTag('STSCOMPRAS', 'G');
  if (p.historico) xml += montaTag('HISTORICOCURTO', p.historico);
  xml += montaTag('CODCOLIGADA1', p.codcoligada);
  xml += montaTag('IDMOVHST', '-1');
  xml += '</TMOV>';

  // === TNFE ===
  xml += '<TNFE>';
  xml += montaTag('CODCOLIGADA', p.codcoligada);
  xml += montaTag('IDMOV', '-1');
  xml += montaTag('VALORSERVICO', '0.0000');
  xml += montaTag('DEDUCAOSERVICO', '0.0000');
  xml += montaTag('ALIQUOTAISS', '0.0000');
  xml += montaTag('ISSRETIDO', '0');
  xml += montaTag('VALORISS', '0.0000');
  xml += montaTag('BASEDECALCULO', '0.0000');
  xml += montaTag('EDITADO', '0');
  xml += '</TNFE>';

  // === TMOVFISCAL ===
  xml += '<TMOVFISCAL>';
  xml += montaTag('CODCOLIGADA', p.codcoligada);
  xml += montaTag('IDMOV', '-1');
  xml += montaTag('CONTRIBUINTECREDENCIADO', '0');
  xml += montaTag('OPERACAOCONSUMIDORFINAL', '0');
  xml += montaTag('OPERACAOPRESENCIAL', '0');
  xml += '</TMOVFISCAL>';

  // === TMOVRATCCU ===
  xml += '<TMOVRATCCU>';
  xml += montaTag('CODCOLIGADA', p.codcoligada);
  xml += montaTag('IDMOV', '-1');
  xml += montaTag('CODCCUSTO', p.codccusto);
  xml += montaTag('VALOR', '0.0000');
  xml += montaTag('IDMOVRATCCU', '-1');
  xml += '</TMOVRATCCU>';

  // === ITENS ===
  p.itens.forEach((item, idx) => {
    const seq = String(idx + 1);

    xml += '<TITMMOV>';
    xml += montaTag('CODCOLIGADA', p.codcoligada);
    xml += montaTag('IDMOV', '-1');
    xml += montaTag('NSEQITMMOV', seq);
    xml += montaTag('CODFILIAL', p.codfilial);
    xml += montaTag('NUMEROSEQUENCIAL', seq);
    xml += montaTag('IDPRD', String(item.IDPRD));
    xml += montaTag('QUANTIDADE', String(item.QUANTIDADE));
    xml += montaTag('QUANTIDADEARECEBER', String(item.QUANTIDADE));
    xml += montaTag('QUANTIDADEORIGINAL', String(item.QUANTIDADE));
    xml += montaTag('QUANTIDADETOTAL', String(item.QUANTIDADE));
    xml += montaTag('PRECOUNITARIO', String(item.PRECOUNITARIO));
    xml += montaTag('PRECOTABELA', '0.0000');
    xml += montaTag('DATAEMISSAO', dataHoje);
    xml += montaTag('CODTB1FAT', '015');
    if (item.CODUND) xml += montaTag('CODUND', item.CODUND);
    xml += montaTag('VALORUNITARIO', '0.0000');
    xml += montaTag('VALORDESC', '0.0000');
    xml += montaTag('VALORFINANCEIRO', '0.0000');
    xml += montaTag('CODCCUSTO', item.CODCCUSTO || p.codccusto);
    xml += montaTag('CODLOC', item.CODLOC || p.codloc);
    if (item.CODVEN1 || p.codven1) xml += montaTag('CODVEN1', item.CODVEN1 || p.codven1 || '');
    if (item.CODTBORCAMENTO) xml += montaTag('CODTBORCAMENTO', item.CODTBORCAMENTO);
    xml += montaTag('CODCOLTBORCAMENTO', item.CODCOLTBORCAMENTO || '0');
    xml += montaTag('FLAG', '0');
    xml += montaTag('INTEGRAAPLICACAO', 'T');
    xml += montaTag('PRODUTOSUBSTITUTO', '0');
    xml += montaTag('PRECOUNITARIOSELEC', '2');
    xml += montaTag('CODCOLIGADA1', p.codcoligada);
    xml += montaTag('IDMOVHST', '-1');
    xml += montaTag('NSEQITMMOV1', seq);
    xml += '</TITMMOV>';

    xml += '<TITMMOVRATCCU>';
    xml += montaTag('CODCOLIGADA', p.codcoligada);
    xml += montaTag('IDMOV', '-1');
    xml += montaTag('NSEQITMMOV', seq);
    xml += montaTag('CODCCUSTO', item.CODCCUSTO || p.codccusto);
    xml += montaTag('VALOR', '0.0000');
    xml += montaTag('IDMOVRATCCU', '-1');
    xml += '</TITMMOVRATCCU>';

    xml += '<TITMMOVCOMPL>';
    xml += montaTag('CODCOLIGADA', p.codcoligada);
    xml += montaTag('IDMOV', '-1');
    xml += montaTag('NSEQITMMOV', seq);
    xml += '</TITMMOVCOMPL>';

    xml += '<TITMMOVFISCAL>';
    xml += montaTag('CODCOLIGADA', p.codcoligada);
    xml += montaTag('IDMOV', '-1');
    xml += montaTag('NSEQITMMOV', seq);
    xml += montaTag('QTDECONTRATADA', '0.0000');
    xml += montaTag('VLRTOTTRIB', '0.0000');
    xml += montaTag('AQUISICAOPAA', '0');
    xml += montaTag('POEBTRIBUTAVEL', '1');
    xml += '</TITMMOVFISCAL>';

  });

  // === TMOVCOMPL ===
  xml += '<TMOVCOMPL>';
  xml += montaTag('CODCOLIGADA', p.codcoligada);
  xml += montaTag('IDMOV', '-1');
  xml += montaTag('MULTIPLO', 'N');
  if (p.ticketRaiz) xml += montaTag('HEFLO', p.ticketRaiz);
  xml += '</TMOVCOMPL>';

  // === TMOVTRANSP ===
  xml += '<TMOVTRANSP>';
  xml += montaTag('CODCOLIGADA', p.codcoligada);
  xml += montaTag('IDMOV', '-1');
  xml += montaTag('RETIRAMERCADORIA', '0');
  xml += montaTag('TIPOCTE', '0');
  xml += montaTag('TOMADORTIPO', '0');
  xml += montaTag('LOTACAO', '1');
  xml += '</TMOVTRANSP>';

  xml += '</MovMovimento>';
  return xml;
}

export function montaXmlTitmmovrelac(
  codcoligada: string,
  idmovOC: string,
  itens: Array<{ IDMOVORIGEM: string | number; NSEQITMMOVORIGEM: string | number; CODCOLORIGEM: string; NSEQITMMOVDESTINO: string; QUANTIDADE: number }>
): string {
  let xml = '<MovMovimento>';
  xml += '<TMOV>';
  xml += montaTag('CODCOLIGADA', codcoligada);
  xml += montaTag('IDMOV', idmovOC);
  xml += '</TMOV>';

  for (const item of itens) {
    xml += '<TITMMOVRELAC>';
    xml += montaTag('IDMOVORIGEM', String(item.IDMOVORIGEM));
    xml += montaTag('NSEQITMMOVORIGEM', String(item.NSEQITMMOVORIGEM));
    xml += montaTag('CODCOLORIGEM', item.CODCOLORIGEM);
    xml += montaTag('IDMOVDESTINO', idmovOC);
    xml += montaTag('NSEQITMMOVDESTINO', item.NSEQITMMOVDESTINO);
    xml += montaTag('CODCOLDESTINO', codcoligada);
    xml += montaTag('QUANTIDADE', String(item.QUANTIDADE));
    xml += '</TITMMOVRELAC>';
  }

  xml += '</MovMovimento>';
  return xml;
}
