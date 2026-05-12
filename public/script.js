// ========== CALENDÁRIO COM FLATPICKR ==========
let calendarInstance = null;
const inputData = document.getElementById('data');

if (inputData) {
  const hoje = new Date();
  const dataMinima = new Date(hoje.getTime() + 24 * 60 * 60 * 1000); // Próximo dia

  calendarInstance = flatpickr(inputData, {
    locale: 'pt',
    minDate: dataMinima,
    maxDate: new Date(hoje.getFullYear(), hoje.getMonth() + 3, hoje.getDate()),
    dateFormat: 'Y-m-d',
    enableTime: false,
    static: false,
    theme: 'light',
    animate: true,
    disableMobile: false,
    monthSelectorType: 'dropdown',
    onChange: async (selectedDates) => {
      if (selectedDates.length > 0) {
        const data = selectedDates[0].toISOString().split('T')[0];
        await carregarHorarios(data);
      }
    }
  });
}

// ========== SELETOR VISUAL DE HORÁRIOS ==========
const horariosContainer = document.getElementById('horarios-container');
const inputHorario = document.getElementById('horario');

async function carregarHorarios(data) {
  if (!data) {
    horariosContainer.innerHTML = '<div class="horarios-placeholder">Selecione uma data válida</div>';
    return;
  }

  horariosContainer.innerHTML = '<div class="horarios-placeholder">⏳ Carregando horários...</div>';

  try {
    const res = await fetch(`/api/horarios?data=${encodeURIComponent(data)}`);
    const horarios = await res.json();

    if (Array.isArray(horarios) && horarios.length > 0) {
      renderizarHorarios(horarios);
    } else {
      horariosContainer.innerHTML = '<div class="horarios-placeholder">❌ Nenhum horário disponível para esta data</div>';
    }
  } catch (error) {
    console.error('Erro ao carregar horários:', error);
    horariosContainer.innerHTML = '<div class="horarios-placeholder">⚠️ Erro ao carregar horários</div>';
  }
}

function renderizarHorarios(horarios) {
  horariosContainer.innerHTML = '';

  horarios.forEach(horario => {
    const horarioFormatado = horario.hora || horario.horario || horario.value || horario;
    
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'horario-btn';
    btn.textContent = horarioFormatado;
    btn.dataset.horario = horarioFormatado;
    
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Remove seleção anterior
      document.querySelectorAll('.horario-btn').forEach(b => b.classList.remove('selected'));
      
      // Marca novo selecionado
      btn.classList.add('selected');
      inputHorario.value = horarioFormatado;
      
      // Animação
      btn.style.animation = 'bounce 0.6s ease';
    });

    horariosContainer.appendChild(btn);
  });
}

// ========== MANIPULAÇÃO DO FORMULÁRIO DE AGENDAMENTO ==========
const formAgendamento = document.getElementById('formAgendamento');
const mensagemDiv = document.getElementById('mensagem');

if (formAgendamento) {
  formAgendamento.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Verifica se está logado
    const session = await fetch('/api/session').then(r => r.json());
    if (!session.loggedIn) {
      window.location.href = 'login.html';
      return;
    }

    // Coletar dados do formulário
    const nome = document.getElementById('nome').value.trim();
    const telefone = document.getElementById('telefone').value.trim();
    const data = inputData.value;
    const horario = inputHorario.value;
    const servico = document.getElementById('servico').value;

    // Validação básica
    if (!nome || !telefone || !data || !horario || !servico) {
      mostrarMensagem('Por favor, preencha todos os campos', 'erro');
      return;
    }

    // Validar formato de telefone
    if (!validarTelefone(telefone)) {
      mostrarMensagem('Por favor, insira um telefone válido', 'erro');
      return;
    }

    // Validar se a data não é no passado
    const dataEscolhida = new Date(data);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    if (dataEscolhida < hoje) {
      mostrarMensagem('Por favor, selecione uma data futura', 'erro');
      return;
    }

    try {
      // Mostrar loading
      const submitBtn = formAgendamento.querySelector('button[type="submit"]');
      const originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = '✨ Agendando...';

      // Enviar dados para o servidor
      const response = await fetch('/api/agendar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          nome,
          telefone,
          data,
          horario,
          servico
        })
      });

      const resultado = await response.json();

      if (response.ok) {
        mostrarMensagem(
          `✓ Agendamento confirmado! ${nome}, seu corte está marcado para ${formatarData(data)} às ${horario}.`,
          'sucesso'
        );
        formAgendamento.reset();
        inputHorario.value = '';

        // Recarrega os horários da data selecionada para refletir o slot agora ocupado
        if (data) {
          await carregarHorarios(data);
        } else {
          horariosContainer.innerHTML = '<div class="horarios-placeholder">Selecione uma data</div>';
        }

        setTimeout(() => {
          mensagemDiv.scrollIntoView({ behavior: 'smooth' });
        }, 300);
      } else {
        mostrarMensagem(resultado.error || 'Erro ao realizar agendamento', 'erro');
        // Se o horário foi tomado por outra pessoa, recarrega a lista
        if (response.status === 409 && data) {
          await carregarHorarios(data);
        }
      }
    } catch (err) {
      console.error('Erro:', err);
      mostrarMensagem('Erro ao conectar com o servidor. Tente novamente mais tarde.', 'erro');
    } finally {
      // Esconder loading
      const submitBtn = formAgendamento.querySelector('button[type="submit"]');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirmar Agendamento';
    }
  });
}

// ========== FUNÇÕES AUXILIARES ==========

// Função para mostrar mensagem
function mostrarMensagem(mensagem, tipo) {
  mensagemDiv.textContent = mensagem;
  mensagemDiv.className = `mensagem ${tipo}`;
  mensagemDiv.style.display = 'block';

  // Auto-ocultar após 5 segundos se for sucesso
  if (tipo === 'sucesso') {
    setTimeout(() => {
      mensagemDiv.style.display = 'none';
    }, 5000);
  }
}

// Máscara automática para telefone (99) 99999-9999
document.addEventListener('DOMContentLoaded', () => {
  const inputTelefone = document.getElementById('telefone');
  if (inputTelefone) {
    inputTelefone.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '');
      if (v.length > 11) v = v.slice(0, 11);
      if (v.length > 6) {
        e.target.value = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
      } else if (v.length > 2) {
        e.target.value = `(${v.slice(0,2)}) ${v.slice(2)}`;
      } else if (v.length > 0) {
        e.target.value = `(${v}`;
      }
    });
  }
});

// Função para validar telefone
function validarTelefone(telefone) {
  // Remove caracteres especiais
  const apenasNumeros = telefone.replace(/\D/g, '');
  // Verifica se tem 11 dígitos (padrão celular BR)
  return apenasNumeros.length === 11;
}

// Função para formatar data
function formatarData(dataString) {
  const [ano, mes, dia] = dataString.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Função para suavizar scroll dos links de navegação
document.querySelectorAll('nav a').forEach(link => {
  link.addEventListener('click', (e) => {
    const href = link.getAttribute('href');
    if (href.startsWith('#')) {
      e.preventDefault();
      const elemento = document.querySelector(href);
      if (elemento) {
        elemento.scrollIntoView({ behavior: 'smooth' });
      }
    }
  });
});
