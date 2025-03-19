/**
 * Configuração do esbuild para o Serverless Framework
 */
module.exports = {
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  },
  minify: process.env.NODE_ENV === 'production',
  sourcemap: true,
  bundle: true,
  target: 'node22',
  platform: 'node',
  exclude: ['aws-sdk']
};