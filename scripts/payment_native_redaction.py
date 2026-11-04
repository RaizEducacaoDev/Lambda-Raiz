"""Pure full native-message redaction; no logging, persistence or network."""
import re
def redact(message,secrets):
 value=message;counts={}
 for secret in sorted({str(s)for s in secrets if s},key=len,reverse=True):
  n=value.count(secret)
  if n:value=value.replace(secret,'[REDACTED_KNOWN_VALUE]');counts['knownValue']=counts.get('knownValue',0)+n
 patterns={
  'authorization':r'(?im)["\x27]?authorization["\x27]?\s*[:=]\s*[^\r\n<]+',
  'token':r'(?i)\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+',
  'credential':r'(?im)["\x27]?(?:password|pwd|senha|access_token|refresh_token|client_secret)["\x27]?\s*[=:]\s*[^\r\n;<]+',
  'xmlCredential':r'(?is)<(?:password|pwd|senha|token|access_token|refresh_token|client_secret)\b[^>]*>.*?</[^>]+>',
  'connectionString':r'(?im)(?:connection\s*string|connectionstring)\s*[:=]\s*[^\r\n<]+',
  'databaseConnection':r'(?im)(?:data source|server)\s*=\s*[^\r\n<]*(?:initial catalog|database|user id|password)\s*=[^\r\n<]*',
  'urlCredentials':r'(?i)https?://[^\s/@:]+:[^\s/@]+@',
  'email':r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}',
  'personalDocument':r'(?<!\d)(?:\d{3}[.]\d{3}[.]\d{3}-\d{2}|\d{2}[.]\d{3}[.]\d{3}/\d{4}-\d{2})(?!\d)',
  'personalField':r'(?im)\b(?:cpf|cnpj|favorecido|titular|agencia|conta|telefone|chave\s*pix)\s*[:=]\s*[^\r\n;<]+',
  'requestXml':r'(?is)<(?:[A-Za-z_]\w*:)?FinLAN\b[^>]*>.*?</(?:[A-Za-z_]\w*:)?FinLAN>',
  'requestHeaders':r'(?ims)^(?:request headers|headers da requisicao|headers da requisição)\s*:.*?(?=^\s*$|\Z)',
 }
 for name,pattern in patterns.items():value,n=re.subn(pattern,'[REDACTED_'+name.upper()+']',value);counts[name]=n
 if any(str(s)in value for s in secrets if s):raise ValueError('SECRET_REDACTION_FAILED')
 return value,counts

def known_pii(data):
 values=[]
 if isinstance(data,dict):
  for key,value in data.items():
   if isinstance(value,str)and len(value.strip())>=3 and re.search(r'(?i)favorecido|titular|cgcf|cpf|cnpj|documento|email|telefone|celular|chave|agencia|(?:^|da|de)conta|nome.*fornecedor|razao',key):
    values.extend([value,value.upper(),value.lower()]);digits=re.sub(r'\D','',value)
    if len(digits)>=8:values.append(digits)
   elif isinstance(value,(dict,list)):values.extend(known_pii(value))
 elif isinstance(data,list):
  for value in data:values.extend(known_pii(value))
 return values
