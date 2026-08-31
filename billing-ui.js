(() => {
  const root = document.querySelector('#billing-area');
  if (!root) return;

  function message(text, ok = false) {
    let el = root.querySelector('.billing-message');
    if (!el) {
      el = document.createElement('div');
      el.className = 'message billing-message';
      root.appendChild(el);
    }
    el.textContent = text || '';
    el.className = 'message billing-message ' + (ok ? 'success' : 'error');
  }

  function fmtDate(value) {
    const date = new Date(value || '');
    return Number.isFinite(date.getTime())
      ? date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '';
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.href = '/login';
      throw new Error('Sessão expirada.');
    }
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
  }

  function button(label, className, onClick, disabled = false) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener('click', onClick);
    return btn;
  }

  async function openCheckout(plan, btn) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Abrindo checkout…';
    message('');
    try {
      const data = await api('/api/billing-checkout', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      location.assign(data.url);
    } catch (error) {
      message(error.message);
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function openPortal(btn) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Abrindo portal…';
    message('');
    try {
      const data = await api('/api/billing-portal', { method: 'POST', body: '{}' });
      location.assign(data.url);
    } catch (error) {
      message(error.message);
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  function planCard({ title, price, detail, current, planKey, available, mode, canCheckout, managed }) {
    const card = document.createElement('div');
    card.className = 'billing-plan' + (current ? ' current' : '');
    const h3 = document.createElement('h3');
    h3.textContent = title + (current ? ' · atual' : '');
    const priceEl = document.createElement('div');
    priceEl.className = 'billing-price';
    priceEl.textContent = price;
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = detail;
    card.append(h3, priceEl, p);
    if (!current) {
      if (managed && !canCheckout) {
        card.appendChild(button('Alterar no portal', 'btn btn-light', event => openPortal(event.currentTarget), !available));
      } else {
        const label = available ? (mode === 'test' ? 'Testar assinatura' : `Escolher ${title}`) : 'Em preparação';
        card.appendChild(button(label, 'btn btn-primary', event => openCheckout(planKey, event.currentTarget), !available || !canCheckout));
      }
    }
    return card;
  }

  function subscriptionMessage(user) {
    const billing = user.billing || {};
    const status = String(billing.status || '').toLowerCase();
    const period = fmtDate(billing.currentPeriodEnd);
    const grace = fmtDate(billing.graceUntil);
    if (!billing.managed) return 'Sem assinatura paga ativa.';
    if (billing.cancelAtPeriodEnd && period) return `Cancelamento agendado. O acesso atual continua até ${period}.`;
    if (status === 'past_due') return grace ? `Pagamento pendente. Período de tolerância até ${grace}.` : 'Pagamento pendente. Atualize a forma de pagamento no portal.';
    if (status === 'active') return period ? `Assinatura ativa · período atual até ${period}.` : 'Assinatura ativa.';
    if (status === 'trialing') return period ? `Período de teste ativo · até ${period}.` : 'Período de teste ativo.';
    if (status === 'incomplete') return 'Assinatura aguardando conclusão do primeiro pagamento.';
    if (status === 'paused') return 'Assinatura pausada. Use o portal para regularizar ou retomar.';
    if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') return 'Assinatura sem acesso pago ativo.';
    return status ? `Assinatura: ${status}.` : 'Assinatura vinculada aguardando confirmação do Stripe.';
  }

  function render(data) {
    root.textContent = '';
    const user = data.user || {};
    const billing = data.billing || {};
    const userBilling = user.billing || {};
    const status = document.createElement('div');
    status.className = 'billing-status';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = `Plano ${user.plano || 'Free'}`;
    const info = document.createElement('span');
    info.className = 'small muted';
    info.textContent = subscriptionMessage(user);
    status.append(badge, info);
    root.appendChild(status);

    const canCheckout = userBilling.canStartCheckout !== false;
    const managed = Boolean(userBilling.managed);
    const grid = document.createElement('div');
    grid.className = 'billing-grid';
    grid.appendChild(planCard({
      title: 'Starter',
      price: 'R$ 47/mês',
      detail: 'Até 50 depoimentos. Limite comercial ainda em validação antes da cobrança pública.',
      current: user.planoKey === 'starter',
      planKey: 'starter',
      available: Boolean(billing.available),
      mode: billing.mode,
      canCheckout,
      managed,
    }));
    grid.appendChild(planCard({
      title: 'Pro',
      price: 'R$ 97/mês',
      detail: 'Depoimentos ilimitados no produto. Cobrança somente após confirmação do Stripe.',
      current: user.planoKey === 'pro',
      planKey: 'pro',
      available: Boolean(billing.available),
      mode: billing.mode,
      canCheckout,
      managed,
    }));
    root.appendChild(grid);

    if (userBilling.hasStripeCustomer) {
      const actions = document.createElement('div');
      actions.className = 'billing-actions';
      actions.style.marginTop = '12px';
      actions.appendChild(button('Gerenciar assinatura', 'btn btn-light', event => openPortal(event.currentTarget), !billing.available));
      root.appendChild(actions);
    }

    const note = document.createElement('p');
    note.className = 'small muted';
    note.style.marginBottom = '0';
    if (!billing.available) note.textContent = 'Planos pagos estão preparados no código, mas a cobrança ainda não foi ativada.';
    else if (billing.mode === 'test') note.textContent = 'Stripe está em modo de teste. Nenhuma cobrança real será feita.';
    else note.textContent = 'Pagamento processado com segurança pelo Stripe.';
    root.appendChild(note);
    root.appendChild(document.createElement('div')).className = 'message billing-message';
  }

  api('/api/dashboard').then(render).catch(error => {
    root.textContent = '';
    const el = document.createElement('div');
    el.className = 'message error';
    el.textContent = error.message;
    root.appendChild(el);
  });
})();
