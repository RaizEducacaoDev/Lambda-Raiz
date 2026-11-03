module.exports = (key, changes = {}) => ({
  DOC_VERSION:1, REQUEST_COMPANY:Number(key.codColigada), REQUEST_BRANCH:Number(key.codFilial),
  REQUEST_SUPPLIER_COMPANY:Number(key.codColCfo), REQUEST_SUPPLIER:key.codCfo,
  REQUEST_MOVEMENT_TYPE:key.codTmv, REQUEST_NUMBER:key.numero, REQUEST_SERIES:key.serie,
  HAS_MOVEMENT_TYPE:1, MASK:'#########', PRINCIPAL_COUNT:1, SERIES_MATCH_COUNT:1,
  EFFECTIVE_SERIES:key.serie || '1', EFFECTIVE_NUMBER:key.numero.padStart(9, '0'),
  EFFECTIVE_DOCUMENT_TYPE:'002', DOC_MATCH_COUNT:0, ...changes,
});
