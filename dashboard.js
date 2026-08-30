const $ = s => document.querySelector(s);

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));
}

function setMsg(el, text, ok = false) {
  if (!el) return;
  el.textContent = text;
  el.className = 'message ' + (ok ? 'success' : 'error');
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.oldText = btn.textContent;
    btn.textContent = label;
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.oldText || btn.textContent;
    btn.disabled = false;
  }
}

async function api(url, opt = {}) {
  const response = await fetch(url, {
    ...opt,
    headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    location.href = '/login';
    throw new Error('Sessão expirada');
  }
  if (!response.ok) throw new Error(data.error || 'Erro inesperado');
  return data;
}

function absoluteLink(link) {
  return link.startsWith('/') ? location.origin + link : link;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

function whatsappText(campaign) {
  const link = absoluteLink(campaign.link || '');
  const custom = String(campaign.mensagemWhatsApp || '').trim();
  if (custom) return `${custom}\n\n${link}`;
  return `Oi! Estou coletando alguns depoimentos sobre meu trabalho e gostaria muito de contar com o seu.\n\nLeva menos de 1 minuto:\n${link}\n\nObrigado!`;
}

function renderCampaigns(items) {
  const el = $('#campaigns');
  if (!items.length) {
    el.innerHTML = '<div class="empty"><strong>Nenhuma campanha ainda.</strong><br>Crie sua primeira campanha para começar a coletar depoimentos.</div>';
    return;
  }

  el.innerHTML = items.map(c => `
    <div class="item">
      <div class="item-head"><div>
        <h3>${esc(c.nome)}</h3>
        <span class="small muted">${esc(c.status)} · ${c.totalRespostas || 0} resposta(s)</span>
      </div></div>
      <div class="linkbox">
        <input readonly value="${esc(absoluteLink(c.link || ''))}" aria-label="Link público">
        <button class="btn btn-light copy" data-link="${esc(c.link || '')}">Copiar link</button>
        <button class="btn btn-whatsapp share" data-id="${esc(c.id)}">WhatsApp</button>
      </div>
      <div class="message item-msg" aria-live="polite"></div>
    </div>`).join('');

  el.querySelectorAll('.copy').forEach(btn => btn.addEventListener('click', async () => {
    const box = btn.closest('.item');
    try {
      await copyText(absoluteLink(btn.dataset.link || ''));
      const old = btn.textContent;
      btn.textContent = 'Copiado ✓';
      setMsg(box.querySelector('.item-msg'), 'Link copiado.', true);
      setTimeout(() => { btn.textContent = old; }, 1600);
    } catch {
      setMsg(box.querySelector('.item-msg'), 'Não foi possível copiar o link.');
    }
  }));

  el.querySelectorAll('.share').forEach(btn => btn.addEventListener('click', () => {
    const campaign = items.find(x => x.id === btn.dataset.id);
    if (campaign) {
      window.open(`https://wa.me/?text=${encodeURIComponent(whatsappText(campaign))}`, '_blank', 'noopener,noreferrer');
    }
  }));
}

function renderTestimonials(items) {
  const el = $('#testimonials');
  if (!items.length) {
    el.innerHTML = '<div class="empty"><strong>Nenhum depoimento recebido.</strong><br>Compartilhe o link da sua campanha para receber o primeiro.</div>';
    return;
  }

  el.innerHTML = items.map(t => `
    <div class="item" data-testimonial-id="${esc(t.id)}">
      <div class="item-head"><div>
        <h3>${esc(t.nomeCliente)} · ${'★'.repeat(t.nota || 0)}</h3>
        <span class="small muted">${esc(t.status)} · ${esc(t.origem)}</span>
      </div></div>
      <p>${esc(t.texto)}</p>
      <div class="item-actions">
        ${t.status === 'Pendente' ? `
          <button class="btn btn-primary moderate" data-id="${esc(t.id)}" data-status="Aprovado">Aprovar</button>
          <button class="btn btn-danger moderate" data-id="${esc(t.id)}" data-status="Rejeitado">Rejeitar</button>` : ''}
        ${t.consentimento && t.status === 'Aprovado' ? `
          <button class="btn btn-light withdraw" data-id="${esc(t.id)}">Retirar publicação</button>` : ''}
        <button class="btn btn-danger delete-testimonial" data-id="${esc(t.id)}">Excluir</button>
      </div>
      <div class="message item-msg" aria-live="polite"></div>
    </div>`).join('');

  el.querySelectorAll('.moderate').forEach(btn => btn.addEventListener('click', async () => {
    const box = btn.closest('.item');
    const verb = btn.dataset.status === 'Aprovado' ? 'Aprovando…' : 'Rejeitando…';
    setBusy(btn, true, verb);
    try {
      await api('/api/moderate', {
        method: 'POST',
        body: JSON.stringify({ testimonialId: btn.dataset.id, status: btn.dataset.status }),
      });
      setMsg(box.querySelector('.item-msg'), 'Depoimento atualizado.', true);
      await load();
    } catch (error) {
      setMsg(box.querySelector('.item-msg'), error.message);
    } finally {
      setBusy(btn, false);
    }
  }));

  el.querySelectorAll('.withdraw').forEach(btn => btn.addEventListener('click', async () => {
    const box = btn.closest('.item');
    setBusy(btn, true, 'Retirando…');
    try {
      await api('/api/moderate', {
        method: 'POST',
        body: JSON.stringify({ testimonialId: btn.dataset.id, withdrawConsent: true }),
      });
      setMsg(box.querySelector('.item-msg'), 'Publicação retirada.', true);
      await load();
    } catch (error) {
      setMsg(box.querySelector('.item-msg'), error.message);
    } finally {
      setBusy(btn, false);
    }
  }));

  el.querySelectorAll('.delete-testimonial').forEach(btn => btn.addEventListener('click', async () => {
    const box = btn.closest('.item');
    const msg = box.querySelector('.item-msg');

    if (btn.dataset.confirmDelete !== '1') {
      btn.dataset.confirmDelete = '1';
      btn.dataset.oldText = btn.textContent;
      btn.textContent = 'Confirmar exclusão';
      setMsg(msg, 'Toque novamente para excluir permanentemente este depoimento.');
      setTimeout(() => {
        if (btn.dataset.confirmDelete === '1') {
          btn.dataset.confirmDelete = '0';
          btn.textContent = btn.dataset.oldText || 'Excluir';
        }
      }, 6000);
      return;
    }

    btn.dataset.confirmDelete = '0';
    setBusy(btn, true, 'Excluindo…');
    try {
      await api('/api/testimonial-delete', {
        method: 'POST',
        body: JSON.stringify({ testimonialId: btn.dataset.id }),
      });
      setMsg(msg, 'Depoimento excluído.', true);
      await load();
    } catch (error) {
      setMsg(msg, error.message);
      setBusy(btn, false);
    }
  }));
}

function renderOnboarding(data) {
  const hasCampaign = data.campaigns.length > 0;
  const hasTestimonial = data.testimonials.length > 0;
  const hasApproved = data.testimonials.some(t => t.status === 'Aprovado' && t.consentimento);
  const hasWidget = (data.widgets || []).some(w => w.ativo && w.publicToken);
  const steps = [
    ['Criar sua primeira campanha', hasCampaign],
    ['Copiar ou compartilhar o link', hasCampaign],
    ['Receber o primeiro depoimento', hasTestimonial],
    ['Aprovar um depoimento', hasApproved],
    ['Ter um widget ativo', hasWidget],
  ];
  const done = steps.filter(x => x[1]).length;
  $('#onboarding-progress').textContent = `${done}/5`;
  $('#onboarding').innerHTML = steps.map(([label, ok], i) => `
    <div class="step ${ok ? 'done' : ''}">
      <span>${ok ? '✓' : i + 1}</span><div>${esc(label)}</div>
    </div>`).join('');
}

function renderWidget(items) {
  const el = $('#widget-area');
  const widget = items?.find(x => x.ativo && x.publicToken);
  if (!widget) {
    el.innerHTML = '<div class="empty">Você ainda não tem um widget ativo. <button id="create-widget" class="btn btn-primary" type="button">Criar widget</button><div id="widget-msg" class="message"></div></div>';
    $('#create-widget')?.addEventListener('click', async event => {
      const btn = event.currentTarget;
      setBusy(btn, true, 'Criando…');
      try {
        await api('/api/widgets', { method: 'POST', body: '{}' });
        await load();
      } catch (error) {
        setMsg($('#widget-msg'), error.message);
      } finally {
        setBusy(btn, false);
      }
    });
    return;
  }

  const src = `${location.origin}/widget?token=${encodeURIComponent(widget.publicToken)}&style=cards&limit=${Math.min(3, widget.limite || 3)}`;
  const embed = widget.codigoEmbed || `<iframe src="${src}" style="width:100%;min-height:280px;border:0" loading="lazy" title="Depoimentos"></iframe>`;
  el.innerHTML = `
    <div class="widget-tools">
      <textarea id="embed-code" readonly>${esc(embed)}</textarea>
      <button id="copy-embed" class="btn btn-light">Copiar código</button>
    </div>
    <iframe class="widget-preview" src="${esc(src)}" loading="lazy" title="Prévia dos depoimentos"></iframe>
    <div id="widget-msg" class="message"></div>`;

  $('#copy-embed')?.addEventListener('click', async () => {
    try {
      await copyText(embed);
      setMsg($('#widget-msg'), 'Código do widget copiado.', true);
    } catch {
      setMsg($('#widget-msg'), 'Não foi possível copiar o código.');
    }
  });
}

async function load() {
  try {
    const data = await api('/api/dashboard');
    $('#header-user').textContent = data.user.email;
    $('#hello').textContent = `Olá, ${data.user.nome || '!'}`;
    $('#plan').textContent = data.user.plano;
    $('#used').textContent = data.user.usados;
    $('#remaining').textContent = data.user.restantes === null ? '∞' : data.user.restantes;
    $('#campaign-count').textContent = data.campaigns.length;
    $('#pending-count').textContent = data.testimonials.filter(x => x.status === 'Pendente').length;
    renderOnboarding(data);
    renderCampaigns(data.campaigns);
    renderTestimonials(data.testimonials);
    renderWidget(data.widgets || []);
  } catch (error) {
    setMsg($('#page-msg'), error.message);
  }
}

$('#campaign-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const msg = $('#campaign-msg');
  const btn = $('#campaign-submit');
  setBusy(btn, true, 'Criando…');
  setMsg(msg, '');
  const form = new FormData(event.currentTarget);
  try {
    await api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        nome: form.get('nome'),
        mensagemEmail: form.get('mensagemEmail'),
        mensagemWhatsApp: form.get('mensagemWhatsApp'),
      }),
    });
    event.currentTarget.reset();
    setMsg(msg, 'Campanha criada. Agora copie o link ou compartilhe no WhatsApp.', true);
    await load();
  } catch (error) {
    setMsg(msg, error.message);
  } finally {
    setBusy(btn, false);
  }
});

$('#logout')?.addEventListener('click', async event => {
  const btn = event.currentTarget;
  setBusy(btn, true, 'Saindo…');
  try {
    await api('/api/logout', { method: 'POST', body: '{}' });
    location.href = '/';
  } catch (error) {
    setMsg($('#page-msg'), error.message);
    setBusy(btn, false);
  }
});

load();
