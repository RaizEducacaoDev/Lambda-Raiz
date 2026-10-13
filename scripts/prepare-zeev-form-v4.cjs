#!/usr/bin/env node
// Applies the narrowly scoped PG/CC form correction to a saved Zeev v4 script.
// Input and output are explicit: this command never edits the published process.
const fs = require('node:fs');
const path = require('node:path');

function prepare(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = (value) => value.replace(/\n/g, newline);
  function replaceOnce(before, after, label) {
    before = lines(before);
    after = lines(after);
    const index = source.indexOf(before);
    if (index < 0 || source.indexOf(before, index + before.length) >= 0) {
      throw new Error(`Trecho ausente ou duplicado: ${label}`);
    }
    source = source.slice(0, index) + after + source.slice(index + before.length);
  }

  replaceOnce(
    '"inpcodigoDoFornecedor", "inpcodigoDaColigada2", "inpcoligada2", "inpfornecedor",',
    '"inpcodigoDoFornecedor", "inpcodigoDaColigada2", "inpcoligada2", "inpfornecedor", "inptipoDoPagamento",',
    'atualização ao trocar tipo de pagamento',
  );

  replaceOnce(
    `      const contextoConsulta = [codigoFornecedor, codigoColigadaDestino].join("|");
      const mesmoContexto = regras._contextoDadosBancarios === contextoConsulta;`,
    `      const tipoPagamento = String(document.querySelector('[xname="inptipoDoPagamento"]')?.value || "")
        .trim().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toUpperCase();
      const contaDeConsumo = tipoPagamento === "CC" || tipoPagamento === "CONTAS DE CONSUMO";
      const contextoConsulta = [codigoFornecedor, codigoColigadaDestino, tipoPagamento].join("|");
      const mesmoContexto = regras._contextoDadosBancarios === contextoConsulta;`,
    'contexto por tipo de pagamento',
  );

  replaceOnce(
    `      regras._mapaNormalizado = new Map();
      regras._dadosBancariosCompletos = [];`,
    `      regras._mapaNormalizado = new Map();
      regras._dadosBancariosCompletos = [];
      // Em toda nova leitura, a chave antiga fica inválida até o cadastro ser reconfirmado.
      const idPagamento = document.querySelector('[xname="inpidPagamento"]');
      const contasCadastradas = document.querySelector('[xname="inpcontasCadastradas"]');
      if (idPagamento) idPagamento.value = "";
      if (contasCadastradas) contasCadastradas.innerHTML = '<option value="">Selecione</option>';`,
    'invalidação de seleção antiga',
  );

  replaceOnce(
    `            if (CODIGOS_BOLETO.has(codigoPagamento) || String(response.fields.ativo).trim() !== "1") continue;
            pagamentosAtivos.push(response);`,
    `            if (String(response.fields.ativo).trim() !== "1") continue;
            // Boleto I não usa cadastro bancário no ramo PG/CC; N exige IDPGTO real.
            if (codigoPagamento === "I" || (codigoPagamento === "N" && !contaDeConsumo)) continue;
            if (codigoPagamento === "N") {
              const id = String(response.fields.idPagamento ?? "").trim();
              const idNumerico = /^[1-9]\\d*$/.test(id);
              const idComposto = /^[1-9]\\d*\\$_\\$\\d+\\$_\\$[A-Za-z0-9._-]+\\$_\\$[1-9]\\d*$/.test(id);
              if (!idNumerico && !idComposto) {
                console.error("Cadastro N ativo sem IDPGTO válido; seleção bloqueada.");
                continue;
              }
            }
            pagamentosAtivos.push(response);`,
    'inclusão segura de cadastros N',
  );

  replaceOnce(
    `      if (valorSelecionado === "Boleto") {
        if (selectContas) {
          selectContas.innerHTML = '<option value="">Selecione</option>';
        }
        preencherIdPagamento({});
        return;
      }`,
    `      if (valorSelecionado === "Boleto") {
        const boletos = contasDoTipo.filter((conta) => String(conta.codigoPagamento).trim() === "N");
        const selecionarBoleto = (conta) => {
          preencherIdPagamento(conta || {});
          preencherCodigoPagamento(conta || {});
          Zeev.Controller.CustomerRules.syncDadoPagamentoIdpgto();
        };
        if (selectContas) {
          selectContas.innerHTML = '<option value="">Selecione o cadastro do boleto</option>';
          boletos.forEach((conta) => {
            const option = document.createElement("option");
            option.value = String(conta.idPagamento).trim();
            option.textContent = "Cadastro de boleto " + option.value.split("$_$").at(-1);
            selectContas.appendChild(option);
          });
          selectContas.onchange = function () {
            selecionarBoleto(boletos.find((conta) => String(conta.idPagamento).trim() === this.value));
          };
        }
        // Com múltiplos cadastros, a pessoa deve escolher o registro exato.
        const unico = boletos.length === 1 ? boletos[0] : null;
        selecionarBoleto(unico);
        if (selectContas) selectContas.value = unico ? String(unico.idPagamento).trim() : "";
        return;
      }`,
    'seleção de boleto N',
  );

  return source;
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || path.resolve(input) === path.resolve(output)) {
    console.error('Uso: node scripts/prepare-zeev-form-v4.cjs <backup.js> <candidato.js>');
    process.exitCode = 2;
  } else {
    fs.writeFileSync(output, prepare(fs.readFileSync(input, 'utf8')), 'utf8');
    console.log(`Candidato salvo em ${output}`);
  }
}

module.exports = { prepare };
