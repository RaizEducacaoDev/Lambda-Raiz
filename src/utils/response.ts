export const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true
};

export const formatResponse = (statusCode: number, body: object) => ({
  statusCode,
  body: JSON.stringify(body, null, 2),
  headers: corsHeaders
});
