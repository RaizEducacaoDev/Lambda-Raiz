import type { AWS } from '@serverless/typescript';

const stage = "${opt:stage, 'dev'}" // HOMOLOGAÇÃO = dev | PRODUÇÃO = prod

const serverlessConfiguration: AWS = {
  service: 'raizapp',
  frameworkVersion: '3.39.0',
  custom: {
    webpack: {
      webpackConfig: './webpack.config.js',
      includeModules: true,
    },
  },
  plugins: ['serverless-webpack', 'serverless-offline'],
  provider: {
    name: 'aws',
    stage: stage,
    runtime: 'nodejs18.x',
    region: 'sa-east-1',
    memorySize: 512,
    timeout: 30,
    apiGateway: { minimumCompressionSize: 1024, shouldStartNameWithService: true },
    environment: {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      Stage: stage, // HOMOLOGAÇÃO = dev | PRODUÇÃO = prod
      DEBUG: 'true',
      URL_SCOREPLAN: '${env:URL_SCOREPLAN}',
      APIKEY_SCOREPLAN: '${env:APIKEY_SCOREPLAN}',
      USERNAME_SCOREPLAN: '${env:USERNAME_SCOREPLAN}',
      PASSWORD_SCOREPLAN: '${env:PASSWORD_SCOREPLAN}',
      USERNAME: '${env:USERNAME_TOTVS}',
      PASSWORD: '${env:PASSWORD_TOTVS}',
      ZEEV_PROD: '${env:ZEEV_PROD}',
      RM_PROD: '${env:RM_PROD}',
      RM_DEV: '${env:RM_DEV}',
      GLPI_PROD: '${env:GLPI_PROD}',
      GLPI_DEV: '${env:GLPI_DEV}',
      TOKEN_ZEEV: '${env:TOKEN_ZEEV}',
      APPTOKEN_GLPI_PROD: '${env:APPTOKEN_GLPI_PROD}',
      APPTOKEN_GLPI_DEV: '${env:APPTOKEN_GLPI_DEV}',
      USERTOKEN_GLPI_PROD: '${env:USERTOKEN_GLPI_PROD}',
      USERTOKEN_GLPI_DEV: '${env:USERTOKEN_GLPI_DEV}',
      CREDENTIALS_GOOGLE: '${env:CREDENTIALS_GOOGLE}'
    },
    lambdaHashingVersion: '20201221',
  },
  functions: {},
};

module.exports = serverlessConfiguration;

const glpiPost = require('./src/integration/glpi/post/index')
const rmPost = require('./src/integration/rm/post/index')
const rmGet = require('./src/integration/rm/get/index')

//ENDPOINTS COM DESTINO AO GLPI
const admissao = glpiPost.admissao
const desligamento = glpiPost.desligamento
const movimentacao = glpiPost.movimentacao
const aberturaDeChamados = glpiPost.aberturaDeChamados

//ENDPOINTS COM DESTINO AO TOTVS RM
const ordemDeCompra = rmPost.ordemDeCompra
const solicitacaoDeCompra = rmPost.solicitacaoDeCompra
const geraQuadroComparativo = rmPost.geraQuadroComparativo
const cotacao = rmPost.cotacao
const cancelaCotacao = rmPost.cancelaCotacao
const comunicaFornecedor = rmPost.comunicaFornecedor
const fileQuadroComparativo = rmPost.fileQuadroComparativo
const gravaNaturezaOrcamentaria = rmPost.gravaNaturezaOrcamentaria
const tokenGoogle = rmGet.tokenGoogle

serverlessConfiguration.functions = {  
  //ENDPOINTS COM DESTINO AO GLPI
  admissao,
  desligamento,
  movimentacao,
  aberturaDeChamados,

  //ENDPOINTS COM DESTINO AO TOTVS RM
  geraQuadroComparativo,
  ordemDeCompra,
  solicitacaoDeCompra,
  cotacao,
  comunicaFornecedor,
  fileQuadroComparativo,
  gravaNaturezaOrcamentaria,
  tokenGoogle,
  cancelaCotacao
}