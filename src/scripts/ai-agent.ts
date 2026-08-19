interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// API mínima del Web Speech Recognition
interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike extends Event {
  readonly results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => unknown) | null;
  onerror: ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEventLike) => unknown) | null;
  start(): void;
  stop(): void;
}

const chatHistory: ChatMessage[] = [];
let currentUtterance: SpeechSynthesisUtterance | null = null;
let globalListenersBound = false;
let chatRequestController: AbortController | null = null;
let aiLifecycleVersion = 0;
let activeRecognition: SpeechRecognitionLike | null = null;
let placeholderTimer: ReturnType<typeof setTimeout> | null = null;
let startErrorTimer: ReturnType<typeof setTimeout> | null = null;
let focusTimer: ReturnType<typeof setTimeout> | null = null;

const clearPlaceholderTimer = () => {
  if (placeholderTimer !== null) {
    clearTimeout(placeholderTimer);
    placeholderTimer = null;
  }
  if (startErrorTimer !== null) {
    clearTimeout(startErrorTimer);
    startErrorTimer = null;
  }
};

function cleanupAiAgent() {
  aiLifecycleVersion += 1;
  clearPlaceholderTimer();
  if (focusTimer !== null) {
    clearTimeout(focusTimer);
    focusTimer = null;
  }
  chatRequestController?.abort();
  chatRequestController = null;
  stopSpeaking();
  if (activeRecognition) {
    activeRecognition.onstart = null;
    activeRecognition.onend = null;
    activeRecognition.onresult = null;
    activeRecognition.onerror = null;
    try { activeRecognition.stop(); } catch {}
    activeRecognition = null;
  }
}


function scrollToBottom() {
  const messagesContainer = document.getElementById('ai-agent-messages');
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stopSpeaking() {
  if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
  document.querySelectorAll('.ai-speak-btn .material-symbols-outlined').forEach(icon => {
    icon.textContent = 'volume_up';
  });
}

function speakText(text: string, button: HTMLButtonElement) {
  if ('speechSynthesis' in window) {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      if (currentUtterance && currentUtterance.text === text) {
        button.querySelector('.material-symbols-outlined')!.textContent = 'volume_up';
        return;
      }
    }

    document.querySelectorAll('.ai-speak-btn .material-symbols-outlined').forEach(icon => {
      icon.textContent = 'volume_up';
    });

    const cleanText = text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'es-MX';

    utterance.onstart = () => {
      button.querySelector('.material-symbols-outlined')!.textContent = 'volume_off';
    };

    utterance.onend = () => {
      button.querySelector('.material-symbols-outlined')!.textContent = 'volume_up';
    };

    utterance.onerror = () => {
      button.querySelector('.material-symbols-outlined')!.textContent = 'volume_up';
    };

    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  } else {
    alert('Tu navegador no soporta síntesis de voz.');
  }
}

function appendUserMessage(text: string) {
  const messagesContainer = document.getElementById('ai-agent-messages');
  if (!messagesContainer) return;
  const msgHtml = `
    <div class="flex justify-end w-full animate-fade-in">
      <div class="max-w-[85%] break-words rounded-2xl rounded-tr-md bg-gradient-to-br from-accent-500 to-accent-600 px-4 py-2.5 text-[13.5px] leading-relaxed text-white shadow-lg shadow-accent-500/20">
        ${escapeHtml(text)}
      </div>
    </div>
  `;
  messagesContainer.insertAdjacentHTML('beforeend', msgHtml);
  scrollToBottom();
}

function appendAssistantLoader(): string {
  const messagesContainer = document.getElementById('ai-agent-messages');
  if (!messagesContainer) return '';
  const id = 'loader-' + Date.now();
  const msgHtml = `
    <div id="${id}" class="flex items-start gap-2.5 max-w-[90%] animate-fade-in">
      <span class="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl border border-accent-200/60 bg-gradient-to-br from-accent-50 to-accent-100/80 text-accent-600 shadow-sm dark:border-accent-900/40 dark:from-accent-950/40 dark:to-accent-900/30 dark:text-accent-300">
        <span class="material-symbols-outlined text-[15px] animate-pulse" style="font-variation-settings:'FILL' 1">auto_awesome</span>
      </span>
      <div class="ai-bubble-content flex items-center min-h-[44px] rounded-2xl rounded-tl-md border border-slate-200/80 bg-white shadow-sm dark:border-white/[0.12] dark:bg-slate-800/60 px-4 py-3 text-[13.5px] leading-relaxed text-slate-800 dark:text-slate-100">
        <div class="flex items-center gap-2">
          <div class="flex gap-1">
            <span class="w-2 h-2 rounded-full bg-accent-500 dark:bg-accent-400 animate-bounce" style="animation-delay: 0ms"></span>
            <span class="w-2 h-2 rounded-full bg-accent-500 dark:bg-accent-400 animate-bounce" style="animation-delay: 150ms"></span>
            <span class="w-2 h-2 rounded-full bg-accent-500 dark:bg-accent-400 animate-bounce" style="animation-delay: 300ms"></span>
          </div>
          <span class="text-xs text-slate-500 dark:text-slate-400 ml-1">Pensando...</span>
        </div>
      </div>
    </div>
  `;
  messagesContainer.insertAdjacentHTML('beforeend', msgHtml);
  scrollToBottom();
  return id;
}

function updateAssistantMessage(id: string, text: string, route: string[] = [], action: string = 'chat') {
  const el = document.getElementById(id);
  if (!el) return;

  const formattedText = escapeHtml(text).replace(/\n/g, '<br/>');

  let actionsHtml = '';
  if (route && route.length > 0) {
    const isMapPage = window.location.pathname.startsWith('/mapa');
    const routeStr = route.join(',');

    actionsHtml += '<div class="flex flex-wrap gap-2 mt-3.5">';

    if (action === 'reserve' && route.length === 1) {
      actionsHtml += `
        <button
          class="ai-reserve-trigger flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-600 hover:to-accent-700 text-white font-bold px-3.5 py-2 text-[11.5px] shadow-lg shadow-accent-500/25 transition-all active:scale-[0.96] hover:shadow-xl hover:shadow-accent-500/30"
          data-monument="${route[0]}"
        >
          <span class="material-symbols-outlined text-[15px]" style="font-variation-settings:'FILL' 1">calendar_month</span>
          Reservar Tour
        </button>
      `;
    } else if (isMapPage) {
      actionsHtml += `
        <button
          class="ai-route-trigger flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-600 hover:to-accent-700 text-white font-bold px-3.5 py-2 text-[11.5px] shadow-lg shadow-accent-500/25 transition-all active:scale-[0.96] hover:shadow-xl hover:shadow-accent-500/30"
          data-route="${routeStr}"
        >
          <span class="material-symbols-outlined text-[15px]" style="font-variation-settings:'FILL' 1">map</span>
          Trazar ruta
        </button>
      `;

      if (route.length === 1) {
        const monument = (window as any).MONUMENTS?.find((m: any) => m.id === route[0]);
        const hasAudio = monument?.audioUrl;

        if (hasAudio) {
          actionsHtml += `
            <button
              class="ai-audio-trigger flex items-center justify-center gap-1.5 rounded-xl border-2 border-slate-300 bg-white hover:border-accent-500 hover:bg-accent-50 text-slate-700 hover:text-accent-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-accent-400 dark:hover:bg-accent-950/30 dark:hover:text-accent-400 font-bold px-3.5 py-2 text-[11.5px] transition-all active:scale-[0.96]"
              data-monument="${route[0]}"
            >
              <span class="material-symbols-outlined text-[15px]" style="font-variation-settings:'FILL' 1">headphones</span>
              Audioguía
            </button>
          `;
        }
      }
    } else {
      actionsHtml += `
        <a
          href="/mapa?route=${routeStr}"
          class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-600 hover:to-accent-700 text-white font-bold px-3.5 py-2 text-[11.5px] shadow-lg shadow-accent-500/25 transition-all active:scale-[0.96] hover:shadow-xl hover:shadow-accent-500/30"
        >
          <span class="material-symbols-outlined text-[15px]" style="font-variation-settings:'FILL' 1">explore</span>
          Ver en el mapa
        </a>
      `;

      if (route.length === 1) {
        const monument = (window as any).MONUMENTS?.find((m: any) => m.id === route[0]);
        const hasAudio = monument?.audioUrl;

        if (hasAudio) {
          actionsHtml += `
            <a
              href="/mapa?route=${route[0]}&play=true"
              class="inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-slate-300 bg-white hover:border-accent-500 hover:bg-accent-50 text-slate-700 hover:text-accent-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-accent-400 dark:hover:bg-accent-950/30 dark:hover:text-accent-400 font-bold px-3.5 py-2 text-[11.5px] transition-all active:scale-[0.96]"
            >
              <span class="material-symbols-outlined text-[15px]" style="font-variation-settings:'FILL' 1">headphones</span>
              Audioguía
            </a>
          `;
        }
      }
    }

    actionsHtml += '</div>';
  }

  const bubbleEl = el.querySelector('.ai-bubble-content');
  if (bubbleEl) {
    bubbleEl.classList.remove('flex', 'items-center', 'min-h-[44px]');
    bubbleEl.classList.add('block', 'break-words', 'relative', 'pr-9');
    bubbleEl.innerHTML = `
      <div class="pr-2">
        ${formattedText}
      </div>
      <button
        class="ai-speak-btn absolute top-3 right-3 p-1 rounded-lg text-slate-400 transition-all hover:bg-slate-100 hover:text-accent-600 active:scale-95 dark:text-slate-500 dark:hover:bg-slate-700/60 dark:hover:text-accent-400"
        title="Escuchar respuesta"
      >
        <span class="material-symbols-outlined text-[15px]">volume_up</span>
      </button>
      ${actionsHtml}
    `;
  }

  const speakBtn = el.querySelector('.ai-speak-btn') as HTMLButtonElement;
  if (speakBtn) {
    speakBtn.addEventListener('click', () => {
      speakText(text, speakBtn);
    });
  }

  if (route && route.length > 0) {
    if (action === 'reserve') {
      const reserveBtn = el.querySelector('.ai-reserve-trigger');
      reserveBtn?.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('ai-reserve-tour', { detail: { monumentId: route[0] } }));
        const aiPopover = document.getElementById('ai-agent-popover');
        if (aiPopover) {
          aiPopover.classList.add('hidden');
          stopSpeaking();
        }
      });
    } else if (window.location.pathname.startsWith('/mapa')) {
      const routeBtn = el.querySelector('.ai-route-trigger');
      routeBtn?.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('ai-route-generated', { detail: { route } }));
      });

      const audioBtn = el.querySelector('.ai-audio-trigger');
      audioBtn?.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('ai-play-audio', { detail: { monumentId: route[0] } }));
      });
    }
  }

  scrollToBottom();
}

let lastInitializedLifecycle = -1;

function initAiAgent() {
  if (lastInitializedLifecycle === aiLifecycleVersion) return;
  lastInitializedLifecycle = aiLifecycleVersion;

  const lifecycleVersion = aiLifecycleVersion;
  const aiBtn = document.getElementById('ai-agent-btn');
  const aiPopover = document.getElementById('ai-agent-popover');
  const aiClose = document.getElementById('ai-agent-close');
  const aiForm = document.getElementById('ai-agent-form') as HTMLFormElement;
  const aiInput = document.getElementById('ai-agent-input') as HTMLInputElement;
  const searchbarBtns = document.querySelectorAll('#ai-agent-btn-searchbar');
  const aiContainer = document.getElementById('ai-agent-container');

  function safeAddListener(
    el: HTMLElement | null,
    event: string,
    handler: EventListenerOrEventListenerObject
  ) {
    if (!el) return;
    const key = `aiBound_${event}`;
    if (el.dataset[key] === 'true') return;
    el.dataset[key] = 'true';
    el.addEventListener(event, handler);
  }

  if (!aiPopover) return;

  if (aiBtn) {
    aiBtn.classList.remove('hidden');
  }

  function resetPosition() {
    if (!aiContainer || !aiPopover) return;
    aiContainer.style.zIndex = '90';
    aiPopover.style.zIndex = '99';
  }

  resetPosition();

  const togglePopover = (e: Event) => {
    e.stopPropagation();
    aiPopover.classList.toggle('hidden');
    if (!aiPopover.classList.contains('hidden')) {
      if (focusTimer !== null) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        focusTimer = null;
        if (lifecycleVersion === aiLifecycleVersion) aiInput?.focus();
      }, 100);
      scrollToBottom();
    }
  };

  if (aiBtn) {
    safeAddListener(aiBtn, 'click', togglePopover);
  }

  searchbarBtns.forEach((btn) => {
    if (btn instanceof HTMLElement) {
      safeAddListener(btn, 'click', togglePopover);
    }
  });

  if (aiClose) {
    safeAddListener(aiClose, 'click', (e) => {
      e.stopPropagation();
      aiPopover.classList.add('hidden');
      stopSpeaking();
    });
  }

  const welcomeSpeakBtn = document.querySelector('#ai-agent-messages .ai-speak-btn') as HTMLButtonElement;
  if (welcomeSpeakBtn) {
    const welcomeText = '¡Hola! Soy Edi, tu guía cultural. Puedo recomendarte rutas, contarte historias de monumentos o ayudarte a planificar tu visita. ¿Qué quieres explorar?';
    safeAddListener(welcomeSpeakBtn, 'click', () => {
      speakText(welcomeText, welcomeSpeakBtn);
    });
  }

  if (aiForm) {
    safeAddListener(aiForm, 'submit', async (e) => {
      e.preventDefault();
      if (!aiInput) return;
      const text = aiInput.value.trim();
      if (!text) return;

    aiInput.value = '';
    appendUserMessage(text);
    chatHistory.push({ role: 'user', content: text });

    const loaderId = appendAssistantLoader();

    const userLat = localStorage.getItem('edificarte_user_lat') || localStorage.getItem('turimap_user_lat');
    const userLng = localStorage.getItem('edificarte_user_lng') || localStorage.getItem('turimap_user_lng');
    const userLocation = userLat && userLng ? {
      lat: parseFloat(userLat),
      lng: parseFloat(userLng)
    } : null;

    const controller = new AbortController();
    chatRequestController?.abort();
    chatRequestController = controller;

    const getVisiblePins = (window as unknown as { __EDIFICARTE_GET_VISIBLE_PINS__?: () => Array<{ id: string; name: string; category?: string; lat: number; lng: number; address?: string }> }).__EDIFICARTE_GET_VISIBLE_PINS__;
    const visiblePins = getVisiblePins ? getVisiblePins() : [];

    try {
      const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: chatHistory,
        userLocation: userLocation,
        visiblePins: visiblePins
      }),
      signal: controller.signal,
    });

      if (!response.ok) {
        throw new Error('Response error');
      }

      const data = await response.json();
      if (lifecycleVersion !== aiLifecycleVersion || controller.signal.aborted) return;
      const botReply = data.reply || 'Disculpa, se me complicó procesar la respuesta en este momento.';
      const botRoute = data.route || [];
      const botAction = data.action || 'chat';
      const botTarget = data.target || '';

      chatHistory.push({ role: 'assistant', content: botReply });
      updateAssistantMessage(loaderId, botReply, botRoute, botAction);

      const isTravelPlan = !!data.isTravelPlan;

      if (isTravelPlan) {
        triggerAirplaneAnimation();
      }

      // Ejecución automática de acciones del Agente Inteligente:
      if (botAction === 'route' && botRoute.length > 0) {
        if (window.location.pathname.startsWith('/mapa')) {
          window.dispatchEvent(new CustomEvent('ai-route-generated', { detail: { route: botRoute } }));
        } else {
          window.location.href = `/mapa?route=${botRoute.join(',')}`;
        }
      } else if (botAction === 'play_audio' && botRoute.length > 0) {
        if (window.location.pathname.startsWith('/mapa')) {
          window.dispatchEvent(new CustomEvent('ai-play-audio', { detail: { monumentId: botRoute[0] } }));
        } else {
          window.location.href = `/mapa?route=${botRoute[0]}&play=true`;
        }
      } else if (botAction === 'reserve' && botRoute.length > 0) {
        window.dispatchEvent(new CustomEvent('ai-reserve-tour', { detail: { monumentId: botRoute[0] } }));
      } else if (botAction === 'navigate' && botTarget) {
        setTimeout(() => {
          window.location.href = botTarget;
        }, 1000);
      } else if (botAction === 'filter_category' && botTarget) {
        if (window.location.pathname.startsWith('/mapa') || window.location.pathname.startsWith('/explorar')) {
          window.dispatchEvent(new CustomEvent('ai-filter-category', { detail: { category: botTarget } }));
        } else {
          window.location.href = `/explorar?category=${encodeURIComponent(botTarget)}`;
        }
      }

    } catch (err) {
      if (controller.signal.aborted || lifecycleVersion !== aiLifecycleVersion) return;
      console.error(err);
      updateAssistantMessage(loaderId, '¡Ups! Algo falló con la conexión. ¿Puedes intentar de nuevo en un momento?');
    } finally {
      if (chatRequestController === controller) chatRequestController = null;
    }
  });
}

  // Desactivar entrada de micrófono para operar únicamente en modo texto
  const micBtn = document.getElementById('ai-mic-btn') as HTMLButtonElement;
  if (micBtn) {
    micBtn.style.display = 'none';
  }
}

function triggerAirplaneAnimation() {
  const overlay = document.getElementById('flight-anim-overlay');
  const plane = document.getElementById('flight-plane');
  if (!overlay || !plane) return;

  overlay.classList.remove('hidden');
  plane.classList.remove('animate-flight');

  void plane.offsetWidth;

  plane.classList.add('animate-flight');

  setTimeout(() => {
    overlay.classList.add('hidden');
    plane.classList.remove('animate-flight');
  }, 3600);
}

document.addEventListener('astro:page-load', () => {
  initAiAgent();
});

if (document.readyState === 'interactive' || document.readyState === 'complete') {
  initAiAgent();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    initAiAgent();
  });
}

document.addEventListener('astro:before-swap', cleanupAiAgent);
window.addEventListener('pagehide', cleanupAiAgent);
window.addEventListener('beforeunload', cleanupAiAgent);

// Registrar listeners globales una sola vez en window/document
if (typeof window !== 'undefined' && !globalListenersBound) {
  globalListenersBound = true;

  if ('visualViewport' in window) {
    const handleViewportResize = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const aiContainer = document.getElementById('ai-agent-container');
      const aiPopover = document.getElementById('ai-agent-popover');
      const bottomNav = document.querySelector('nav.glassmorphism') as HTMLElement | null;
      if (!aiContainer || !aiPopover) return;

      const keyboardOpen = vv.height < window.innerHeight - 100;
      if (keyboardOpen && !aiPopover.classList.contains('hidden')) {
        const keyboardHeight = window.innerHeight - vv.height;
        aiContainer.style.top = 'auto';
        aiContainer.style.bottom = `${keyboardHeight + 16}px`;
        aiContainer.style.right = '12px';
        aiContainer.style.left = 'auto';
        aiContainer.style.transform = 'none';
        aiContainer.style.maxWidth = 'calc(100vw - 24px)';
        aiPopover.style.maxWidth = 'calc(100vw - 24px)';
        aiPopover.style.height = `${Math.max(220, vv.height - keyboardHeight - 16)}px`;
        if (bottomNav) bottomNav.style.transform = 'translateY(100%)';
      } else {
        if (window.location.pathname.startsWith('/mapa')) {
          aiContainer.classList.remove('bottom-[76px]', 'right-4', 'fixed');
          aiContainer.style.position = 'fixed';
          aiContainer.style.top = 'calc(env(safe-area-inset-top, 0px) + 74px)';
          aiContainer.style.left = '50%';
          aiContainer.style.transform = 'translateX(-50%)';
          aiContainer.style.width = '100%';
          aiContainer.style.maxWidth = '512px';
          aiContainer.style.paddingLeft = '16px';
          aiContainer.style.paddingRight = '16px';
          aiContainer.style.zIndex = '40';
          aiContainer.style.pointerEvents = 'none';
          aiContainer.style.bottom = '';
          aiContainer.style.right = '';

          aiPopover.classList.remove('bottom-16', 'mb-2', 'absolute', 'right-0');
          aiPopover.classList.add('relative', 'w-full', 'mt-2');
          aiPopover.style.pointerEvents = 'auto';
          aiPopover.style.height = '380px';
          aiPopover.style.maxHeight = 'calc(100vh - 150px)';
        } else {
          aiContainer.style.position = '';
          aiContainer.style.top = '';
          aiContainer.style.left = '';
          aiContainer.style.transform = '';
          aiContainer.style.width = '';
          aiContainer.style.maxWidth = '';
          aiContainer.style.paddingLeft = '';
          aiContainer.style.paddingRight = '';
          aiContainer.style.zIndex = '';
          aiContainer.style.pointerEvents = '';
          aiContainer.style.bottom = '';
          aiContainer.style.right = '';

          aiPopover.classList.add('bottom-16', 'mb-2', 'absolute', 'right-0');
          aiPopover.classList.remove('relative', 'w-full', 'mt-2');
          aiPopover.style.pointerEvents = '';
          aiPopover.style.height = '';
          aiPopover.style.maxHeight = '';
        }
        if (bottomNav) bottomNav.style.transform = '';
      }
    };

    window.visualViewport?.addEventListener('resize', handleViewportResize);
    window.visualViewport?.addEventListener('scroll', handleViewportResize);

    document.addEventListener('focusin', (e) => {
      const aiInput = document.getElementById('ai-agent-input');
      if (e.target === aiInput) {
        requestAnimationFrame(() => handleViewportResize());
        setTimeout(handleViewportResize, 250);
      }
    });
    document.addEventListener('focusout', (e) => {
      const aiInput = document.getElementById('ai-agent-input');
      if (e.target === aiInput) {
        setTimeout(handleViewportResize, 250);
      }
    });
  }

  document.addEventListener('click', (e) => {
    const aiPopover = document.getElementById('ai-agent-popover');
    const aiBtn = document.getElementById('ai-agent-btn');
    const searchbarBtns = document.querySelectorAll('#ai-agent-btn-searchbar');
    if (!aiPopover || aiPopover.classList.contains('hidden')) return;

    const target = e.target as Node;
    const clickedBtn = (aiBtn && aiBtn.contains(target)) ||
                       Array.from(searchbarBtns).some(btn => btn.contains(target));
    if (!aiPopover.contains(target) && !clickedBtn) {
      aiPopover.classList.add('hidden');
      stopSpeaking();
    }
  });

  window.addEventListener('ai-route-generated', () => {
    const aiPopover = document.getElementById('ai-agent-popover');
    if (aiPopover) {
      aiPopover.classList.add('hidden');
      stopSpeaking();
    }
  });
}
