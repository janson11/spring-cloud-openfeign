var AsciinemaPlayer = (function (exports) {
  'use strict';

  const sharedConfig = {};
  function setHydrateContext(context) {
    sharedConfig.context = context;
  }

  const equalFn = (a, b) => a === b;
  const $PROXY = Symbol("solid-proxy");
  const $TRACK = Symbol("solid-track");
  const signalOptions = {
    equals: equalFn
  };
  let runEffects = runQueue;
  const STALE = 1;
  const PENDING = 2;
  const UNOWNED = {
    owned: null,
    cleanups: null,
    context: null,
    owner: null
  };
  var Owner = null;
  let Transition = null;
  let Listener = null;
  let Updates = null;
  let Effects = null;
  let ExecCount = 0;
  function createRoot(fn, detachedOwner) {
    const listener = Listener,
      owner = Owner,
      unowned = fn.length === 0,
      root = unowned ? UNOWNED : {
        owned: null,
        cleanups: null,
        context: null,
        owner: detachedOwner === undefined ? owner : detachedOwner
      },
      updateFn = unowned ? fn : () => fn(() => untrack(() => cleanNode(root)));
    Owner = root;
    Listener = null;
    try {
      return runUpdates(updateFn, true);
    } finally {
      Listener = listener;
      Owner = owner;
    }
  }
  function createSignal(value, options) {
    options = options ? Object.assign({}, signalOptions, options) : signalOptions;
    const s = {
      value,
      observers: null,
      observerSlots: null,
      comparator: options.equals || undefined
    };
    const setter = value => {
      if (typeof value === "function") {
        value = value(s.value);
      }
      return writeSignal(s, value);
    };
    return [readSignal.bind(s), setter];
  }
  function createRenderEffect(fn, value, options) {
    const c = createComputation(fn, value, false, STALE);
    updateComputation(c);
  }
  function createEffect(fn, value, options) {
    runEffects = runUserEffects;
    const c = createComputation(fn, value, false, STALE);
    c.user = true;
    Effects ? Effects.push(c) : updateComputation(c);
  }
  function createMemo(fn, value, options) {
    options = options ? Object.assign({}, signalOptions, options) : signalOptions;
    const c = createComputation(fn, value, true, 0);
    c.observers = null;
    c.observerSlots = null;
    c.comparator = options.equals || undefined;
    updateComputation(c);
    return readSignal.bind(c);
  }
  function batch(fn) {
    return runUpdates(fn, false);
  }
  function untrack(fn) {
    if (Listener === null) return fn();
    const listener = Listener;
    Listener = null;
    try {
      return fn();
    } finally {
      Listener = listener;
    }
  }
  function onMount(fn) {
    createEffect(() => untrack(fn));
  }
  function onCleanup(fn) {
    if (Owner === null) ;else if (Owner.cleanups === null) Owner.cleanups = [fn];else Owner.cleanups.push(fn);
    return fn;
  }
  function getListener() {
    return Listener;
  }
  function children(fn) {
    const children = createMemo(fn);
    const memo = createMemo(() => resolveChildren(children()));
    memo.toArray = () => {
      const c = memo();
      return Array.isArray(c) ? c : c != null ? [c] : [];
    };
    return memo;
  }
  function readSignal() {
    const runningTransition = Transition ;
    if (this.sources && (this.state || runningTransition )) {
      if (this.state === STALE || runningTransition ) updateComputation(this);else {
        const updates = Updates;
        Updates = null;
        runUpdates(() => lookUpstream(this), false);
        Updates = updates;
      }
    }
    if (Listener) {
      const sSlot = this.observers ? this.observers.length : 0;
      if (!Listener.sources) {
        Listener.sources = [this];
        Listener.sourceSlots = [sSlot];
      } else {
        Listener.sources.push(this);
        Listener.sourceSlots.push(sSlot);
      }
      if (!this.observers) {
        this.observers = [Listener];
        this.observerSlots = [Listener.sources.length - 1];
      } else {
        this.observers.push(Listener);
        this.observerSlots.push(Listener.sources.length - 1);
      }
    }
    return this.value;
  }
  function writeSignal(node, value, isComp) {
    let current = node.value;
    if (!node.comparator || !node.comparator(current, value)) {
      node.value = value;
      if (node.observers && node.observers.length) {
        runUpdates(() => {
          for (let i = 0; i < node.observers.length; i += 1) {
            const o = node.observers[i];
            const TransitionRunning = Transition && Transition.running;
            if (TransitionRunning && Transition.disposed.has(o)) ;
            if (TransitionRunning && !o.tState || !TransitionRunning && !o.state) {
              if (o.pure) Updates.push(o);else Effects.push(o);
              if (o.observers) markDownstream(o);
            }
            if (TransitionRunning) ;else o.state = STALE;
          }
          if (Updates.length > 10e5) {
            Updates = [];
            if (false) ;
            throw new Error();
          }
        }, false);
      }
    }
    return value;
  }
  function updateComputation(node) {
    if (!node.fn) return;
    cleanNode(node);
    const owner = Owner,
      listener = Listener,
      time = ExecCount;
    Listener = Owner = node;
    runComputation(node, node.value, time);
    Listener = listener;
    Owner = owner;
  }
  function runComputation(node, value, time) {
    let nextValue;
    try {
      nextValue = node.fn(value);
    } catch (err) {
      if (node.pure) {
        {
          node.state = STALE;
          node.owned && node.owned.forEach(cleanNode);
          node.owned = null;
        }
      }
      handleError(err);
    }
    if (!node.updatedAt || node.updatedAt <= time) {
      if (node.updatedAt != null && "observers" in node) {
        writeSignal(node, nextValue);
      } else node.value = nextValue;
      node.updatedAt = time;
    }
  }
  function createComputation(fn, init, pure, state = STALE, options) {
    const c = {
      fn,
      state: state,
      updatedAt: null,
      owned: null,
      sources: null,
      sourceSlots: null,
      cleanups: null,
      value: init,
      owner: Owner,
      context: null,
      pure
    };
    if (Owner === null) ;else if (Owner !== UNOWNED) {
      {
        if (!Owner.owned) Owner.owned = [c];else Owner.owned.push(c);
      }
    }
    return c;
  }
  function runTop(node) {
    const runningTransition = Transition ;
    if (node.state === 0 || runningTransition ) return;
    if (node.state === PENDING || runningTransition ) return lookUpstream(node);
    if (node.suspense && untrack(node.suspense.inFallback)) return node.suspense.effects.push(node);
    const ancestors = [node];
    while ((node = node.owner) && (!node.updatedAt || node.updatedAt < ExecCount)) {
      if (node.state || runningTransition ) ancestors.push(node);
    }
    for (let i = ancestors.length - 1; i >= 0; i--) {
      node = ancestors[i];
      if (node.state === STALE || runningTransition ) {
        updateComputation(node);
      } else if (node.state === PENDING || runningTransition ) {
        const updates = Updates;
        Updates = null;
        runUpdates(() => lookUpstream(node, ancestors[0]), false);
        Updates = updates;
      }
    }
  }
  function runUpdates(fn, init) {
    if (Updates) return fn();
    let wait = false;
    if (!init) Updates = [];
    if (Effects) wait = true;else Effects = [];
    ExecCount++;
    try {
      const res = fn();
      completeUpdates(wait);
      return res;
    } catch (err) {
      if (!wait) Effects = null;
      Updates = null;
      handleError(err);
    }
  }
  function completeUpdates(wait) {
    if (Updates) {
      runQueue(Updates);
      Updates = null;
    }
    if (wait) return;
    const e = Effects;
    Effects = null;
    if (e.length) runUpdates(() => runEffects(e), false);
  }
  function runQueue(queue) {
    for (let i = 0; i < queue.length; i++) runTop(queue[i]);
  }
  function runUserEffects(queue) {
    let i,
      userLength = 0;
    for (i = 0; i < queue.length; i++) {
      const e = queue[i];
      if (!e.user) runTop(e);else queue[userLength++] = e;
    }
    if (sharedConfig.context) setHydrateContext();
    for (i = 0; i < userLength; i++) runTop(queue[i]);
  }
  function lookUpstream(node, ignore) {
    const runningTransition = Transition ;
    node.state = 0;
    for (let i = 0; i < node.sources.length; i += 1) {
      const source = node.sources[i];
      if (source.sources) {
        if (source.state === STALE || runningTransition ) {
          if (source !== ignore) runTop(source);
        } else if (source.state === PENDING || runningTransition ) lookUpstream(source, ignore);
      }
    }
  }
  function markDownstream(node) {
    const runningTransition = Transition ;
    for (let i = 0; i < node.observers.length; i += 1) {
      const o = node.observers[i];
      if (!o.state || runningTransition ) {
        o.state = PENDING;
        if (o.pure) Updates.push(o);else Effects.push(o);
        o.observers && markDownstream(o);
      }
    }
  }
  function cleanNode(node) {
    let i;
    if (node.sources) {
      while (node.sources.length) {
        const source = node.sources.pop(),
          index = node.sourceSlots.pop(),
          obs = source.observers;
        if (obs && obs.length) {
          const n = obs.pop(),
            s = source.observerSlots.pop();
          if (index < obs.length) {
            n.sourceSlots[s] = index;
            obs[index] = n;
            source.observerSlots[index] = s;
          }
        }
      }
    }
    if (node.owned) {
      for (i = 0; i < node.owned.length; i++) cleanNode(node.owned[i]);
      node.owned = null;
    }
    if (node.cleanups) {
      for (i = 0; i < node.cleanups.length; i++) node.cleanups[i]();
      node.cleanups = null;
    }
    node.state = 0;
    node.context = null;
  }
  function castError(err) {
    if (err instanceof Error || typeof err === "string") return err;
    return new Error("Unknown error");
  }
  function handleError(err) {
    err = castError(err);
    throw err;
  }
  function resolveChildren(children) {
    if (typeof children === "function" && !children.length) return resolveChildren(children());
    if (Array.isArray(children)) {
      const results = [];
      for (let i = 0; i < children.length; i++) {
        const result = resolveChildren(children[i]);
        Array.isArray(result) ? results.push.apply(results, result) : results.push(result);
      }
      return results;
    }
    return children;
  }

  const FALLBACK = Symbol("fallback");
  function dispose(d) {
    for (let i = 0; i < d.length; i++) d[i]();
  }
  function mapArray(list, mapFn, options = {}) {
    let items = [],
      mapped = [],
      disposers = [],
      len = 0,
      indexes = mapFn.length > 1 ? [] : null;
    onCleanup(() => dispose(disposers));
    return () => {
      let newItems = list() || [],
        i,
        j;
      newItems[$TRACK];
      return untrack(() => {
        let newLen = newItems.length,
          newIndices,
          newIndicesNext,
          temp,
          tempdisposers,
          tempIndexes,
          start,
          end,
          newEnd,
          item;
        if (newLen === 0) {
          if (len !== 0) {
            dispose(disposers);
            disposers = [];
            items = [];
            mapped = [];
            len = 0;
            indexes && (indexes = []);
          }
          if (options.fallback) {
            items = [FALLBACK];
            mapped[0] = createRoot(disposer => {
              disposers[0] = disposer;
              return options.fallback();
            });
            len = 1;
          }
        }
        else if (len === 0) {
          mapped = new Array(newLen);
          for (j = 0; j < newLen; j++) {
            items[j] = newItems[j];
            mapped[j] = createRoot(mapper);
          }
          len = newLen;
        } else {
          temp = new Array(newLen);
          tempdisposers = new Array(newLen);
          indexes && (tempIndexes = new Array(newLen));
          for (start = 0, end = Math.min(len, newLen); start < end && items[start] === newItems[start]; start++);
          for (end = len - 1, newEnd = newLen - 1; end >= start && newEnd >= start && items[end] === newItems[newEnd]; end--, newEnd--) {
            temp[newEnd] = mapped[end];
            tempdisposers[newEnd] = disposers[end];
            indexes && (tempIndexes[newEnd] = indexes[end]);
          }
          newIndices = new Map();
          newIndicesNext = new Array(newEnd + 1);
          for (j = newEnd; j >= start; j--) {
            item = newItems[j];
            i = newIndices.get(item);
            newIndicesNext[j] = i === undefined ? -1 : i;
            newIndices.set(item, j);
          }
          for (i = start; i <= end; i++) {
            item = items[i];
            j = newIndices.get(item);
            if (j !== undefined && j !== -1) {
              temp[j] = mapped[i];
              tempdisposers[j] = disposers[i];
              indexes && (tempIndexes[j] = indexes[i]);
              j = newIndicesNext[j];
              newIndices.set(item, j);
            } else disposers[i]();
          }
          for (j = start; j < newLen; j++) {
            if (j in temp) {
              mapped[j] = temp[j];
              disposers[j] = tempdisposers[j];
              if (indexes) {
                indexes[j] = tempIndexes[j];
                indexes[j](j);
              }
            } else mapped[j] = createRoot(mapper);
          }
          mapped = mapped.slice(0, len = newLen);
          items = newItems.slice(0);
        }
        return mapped;
      });
      function mapper(disposer) {
        disposers[j] = disposer;
        if (indexes) {
          const [s, set] = createSignal(j);
          indexes[j] = set;
          return mapFn(newItems[j], s);
        }
        return mapFn(newItems[j]);
      }
    };
  }
  function indexArray(list, mapFn, options = {}) {
    let items = [],
      mapped = [],
      disposers = [],
      signals = [],
      len = 0,
      i;
    onCleanup(() => dispose(disposers));
    return () => {
      const newItems = list() || [];
      newItems[$TRACK];
      return untrack(() => {
        if (newItems.length === 0) {
          if (len !== 0) {
            dispose(disposers);
            disposers = [];
            items = [];
            mapped = [];
            len = 0;
            signals = [];
          }
          if (options.fallback) {
            items = [FALLBACK];
            mapped[0] = createRoot(disposer => {
              disposers[0] = disposer;
              return options.fallback();
            });
            len = 1;
          }
          return mapped;
        }
        if (items[0] === FALLBACK) {
          disposers[0]();
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
        }
        for (i = 0; i < newItems.length; i++) {
          if (i < items.length && items[i] !== newItems[i]) {
            signals[i](() => newItems[i]);
          } else if (i >= items.length) {
            mapped[i] = createRoot(mapper);
          }
        }
        for (; i < items.length; i++) {
          disposers[i]();
        }
        len = signals.length = disposers.length = newItems.length;
        items = newItems.slice(0);
        return mapped = mapped.slice(0, len);
      });
      function mapper(disposer) {
        disposers[i] = disposer;
        const [s, set] = createSignal(newItems[i]);
        signals[i] = set;
        return mapFn(s, i);
      }
    };
  }
  function createComponent(Comp, props) {
    return untrack(() => Comp(props || {}));
  }
  function trueFn() {
    return true;
  }
  const propTraps = {
    get(_, property, receiver) {
      if (property === $PROXY) return receiver;
      return _.get(property);
    },
    has(_, property) {
      if (property === $PROXY) return true;
      return _.has(property);
    },
    set: trueFn,
    deleteProperty: trueFn,
    getOwnPropertyDescriptor(_, property) {
      return {
        configurable: true,
        enumerable: true,
        get() {
          return _.get(property);
        },
        set: trueFn,
        deleteProperty: trueFn
      };
    },
    ownKeys(_) {
      return _.keys();
    }
  };
  function resolveSource(s) {
    return !(s = typeof s === "function" ? s() : s) ? {} : s;
  }
  function mergeProps(...sources) {
    let proxy = false;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      proxy = proxy || !!s && $PROXY in s;
      sources[i] = typeof s === "function" ? (proxy = true, createMemo(s)) : s;
    }
    if (proxy) {
      return new Proxy({
        get(property) {
          for (let i = sources.length - 1; i >= 0; i--) {
            const v = resolveSource(sources[i])[property];
            if (v !== undefined) return v;
          }
        },
        has(property) {
          for (let i = sources.length - 1; i >= 0; i--) {
            if (property in resolveSource(sources[i])) return true;
          }
          return false;
        },
        keys() {
          const keys = [];
          for (let i = 0; i < sources.length; i++) keys.push(...Object.keys(resolveSource(sources[i])));
          return [...new Set(keys)];
        }
      }, propTraps);
    }
    const target = {};
    for (let i = sources.length - 1; i >= 0; i--) {
      if (sources[i]) {
        const descriptors = Object.getOwnPropertyDescriptors(sources[i]);
        for (const key in descriptors) {
          if (key in target) continue;
          Object.defineProperty(target, key, {
            enumerable: true,
            get() {
              for (let i = sources.length - 1; i >= 0; i--) {
                const v = (sources[i] || {})[key];
                if (v !== undefined) return v;
              }
            }
          });
        }
      }
    }
    return target;
  }

  function For(props) {
    const fallback = "fallback" in props && {
      fallback: () => props.fallback
    };
    return createMemo(mapArray(() => props.each, props.children, fallback || undefined));
  }
  function Index(props) {
    const fallback = "fallback" in props && {
      fallback: () => props.fallback
    };
    return createMemo(indexArray(() => props.each, props.children, fallback || undefined));
  }
  function Show(props) {
    let strictEqual = false;
    const keyed = props.keyed;
    const condition = createMemo(() => props.when, undefined, {
      equals: (a, b) => strictEqual ? a === b : !a === !b
    });
    return createMemo(() => {
      const c = condition();
      if (c) {
        const child = props.children;
        const fn = typeof child === "function" && child.length > 0;
        strictEqual = keyed || fn;
        return fn ? untrack(() => child(c)) : child;
      }
      return props.fallback;
    }, undefined, undefined);
  }
  function Switch(props) {
    let strictEqual = false;
    let keyed = false;
    const equals = (a, b) => a[0] === b[0] && (strictEqual ? a[1] === b[1] : !a[1] === !b[1]) && a[2] === b[2];
    const conditions = children(() => props.children),
      evalConditions = createMemo(() => {
        let conds = conditions();
        if (!Array.isArray(conds)) conds = [conds];
        for (let i = 0; i < conds.length; i++) {
          const c = conds[i].when;
          if (c) {
            keyed = !!conds[i].keyed;
            return [i, c, conds[i]];
          }
        }
        return [-1];
      }, undefined, {
        equals
      });
    return createMemo(() => {
      const [index, when, cond] = evalConditions();
      if (index < 0) return props.fallback;
      const c = cond.children;
      const fn = typeof c === "function" && c.length > 0;
      strictEqual = keyed || fn;
      return fn ? untrack(() => c(when)) : c;
    }, undefined, undefined);
  }
  function Match(props) {
    return props;
  }

  function reconcileArrays(parentNode, a, b) {
    let bLength = b.length,
      aEnd = a.length,
      bEnd = bLength,
      aStart = 0,
      bStart = 0,
      after = a[aEnd - 1].nextSibling,
      map = null;
    while (aStart < aEnd || bStart < bEnd) {
      if (a[aStart] === b[bStart]) {
        aStart++;
        bStart++;
        continue;
      }
      while (a[aEnd - 1] === b[bEnd - 1]) {
        aEnd--;
        bEnd--;
      }
      if (aEnd === aStart) {
        const node = bEnd < bLength ? bStart ? b[bStart - 1].nextSibling : b[bEnd - bStart] : after;
        while (bStart < bEnd) parentNode.insertBefore(b[bStart++], node);
      } else if (bEnd === bStart) {
        while (aStart < aEnd) {
          if (!map || !map.has(a[aStart])) a[aStart].remove();
          aStart++;
        }
      } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
        const node = a[--aEnd].nextSibling;
        parentNode.insertBefore(b[bStart++], a[aStart++].nextSibling);
        parentNode.insertBefore(b[--bEnd], node);
        a[aEnd] = b[bEnd];
      } else {
        if (!map) {
          map = new Map();
          let i = bStart;
          while (i < bEnd) map.set(b[i], i++);
        }
        const index = map.get(a[aStart]);
        if (index != null) {
          if (bStart < index && index < bEnd) {
            let i = aStart,
              sequence = 1,
              t;
            while (++i < aEnd && i < bEnd) {
              if ((t = map.get(a[i])) == null || t !== index + sequence) break;
              sequence++;
            }
            if (sequence > index - bStart) {
              const node = a[aStart];
              while (bStart < index) parentNode.insertBefore(b[bStart++], node);
            } else parentNode.replaceChild(b[bStart++], a[aStart++]);
          } else aStart++;
        } else a[aStart++].remove();
      }
    }
  }

  const $$EVENTS = "_$DX_DELEGATE";
  function render(code, element, init, options = {}) {
    let disposer;
    createRoot(dispose => {
      disposer = dispose;
      element === document ? code() : insert(element, code(), element.firstChild ? null : undefined, init);
    }, options.owner);
    return () => {
      disposer();
      element.textContent = "";
    };
  }
  function template(html, check, isSVG) {
    const t = document.createElement("template");
    t.innerHTML = html;
    let node = t.content.firstChild;
    if (isSVG) node = node.firstChild;
    return node;
  }
  function delegateEvents(eventNames, document = window.document) {
    const e = document[$$EVENTS] || (document[$$EVENTS] = new Set());
    for (let i = 0, l = eventNames.length; i < l; i++) {
      const name = eventNames[i];
      if (!e.has(name)) {
        e.add(name);
        document.addEventListener(name, eventHandler);
      }
    }
  }
  function setAttribute(node, name, value) {
    if (value == null) node.removeAttribute(name);else node.setAttribute(name, value);
  }
  function className(node, value) {
    if (value == null) node.removeAttribute("class");else node.className = value;
  }
  function addEventListener(node, name, handler, delegate) {
    if (delegate) {
      if (Array.isArray(handler)) {
        node[`$$${name}`] = handler[0];
        node[`$$${name}Data`] = handler[1];
      } else node[`$$${name}`] = handler;
    } else if (Array.isArray(handler)) {
      const handlerFn = handler[0];
      node.addEventListener(name, handler[0] = e => handlerFn.call(node, handler[1], e));
    } else node.addEventListener(name, handler);
  }
  function style(node, value, prev) {
    if (!value) return prev ? setAttribute(node, "style") : value;
    const nodeStyle = node.style;
    if (typeof value === "string") return nodeStyle.cssText = value;
    typeof prev === "string" && (nodeStyle.cssText = prev = undefined);
    prev || (prev = {});
    value || (value = {});
    let v, s;
    for (s in prev) {
      value[s] == null && nodeStyle.removeProperty(s);
      delete prev[s];
    }
    for (s in value) {
      v = value[s];
      if (v !== prev[s]) {
        nodeStyle.setProperty(s, v);
        prev[s] = v;
      }
    }
    return prev;
  }
  function use(fn, element, arg) {
    return untrack(() => fn(element, arg));
  }
  function insert(parent, accessor, marker, initial) {
    if (marker !== undefined && !initial) initial = [];
    if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);
    createRenderEffect(current => insertExpression(parent, accessor(), current, marker), initial);
  }
  function eventHandler(e) {
    const key = `$$${e.type}`;
    let node = e.composedPath && e.composedPath()[0] || e.target;
    if (e.target !== node) {
      Object.defineProperty(e, "target", {
        configurable: true,
        value: node
      });
    }
    Object.defineProperty(e, "currentTarget", {
      configurable: true,
      get() {
        return node || document;
      }
    });
    if (sharedConfig.registry && !sharedConfig.done) {
      sharedConfig.done = true;
      document.querySelectorAll("[id^=pl-]").forEach(elem => {
        while (elem && elem.nodeType !== 8 && elem.nodeValue !== "pl-" + e) {
          let x = elem.nextSibling;
          elem.remove();
          elem = x;
        }
        elem && elem.remove();
      });
    }
    while (node) {
      const handler = node[key];
      if (handler && !node.disabled) {
        const data = node[`${key}Data`];
        data !== undefined ? handler.call(node, data, e) : handler.call(node, e);
        if (e.cancelBubble) return;
      }
      node = node._$host || node.parentNode || node.host;
    }
  }
  function insertExpression(parent, value, current, marker, unwrapArray) {
    if (sharedConfig.context && !current) current = [...parent.childNodes];
    while (typeof current === "function") current = current();
    if (value === current) return current;
    const t = typeof value,
      multi = marker !== undefined;
    parent = multi && current[0] && current[0].parentNode || parent;
    if (t === "string" || t === "number") {
      if (sharedConfig.context) return current;
      if (t === "number") value = value.toString();
      if (multi) {
        let node = current[0];
        if (node && node.nodeType === 3) {
          node.data = value;
        } else node = document.createTextNode(value);
        current = cleanChildren(parent, current, marker, node);
      } else {
        if (current !== "" && typeof current === "string") {
          current = parent.firstChild.data = value;
        } else current = parent.textContent = value;
      }
    } else if (value == null || t === "boolean") {
      if (sharedConfig.context) return current;
      current = cleanChildren(parent, current, marker);
    } else if (t === "function") {
      createRenderEffect(() => {
        let v = value();
        while (typeof v === "function") v = v();
        current = insertExpression(parent, v, current, marker);
      });
      return () => current;
    } else if (Array.isArray(value)) {
      const array = [];
      const currentArray = current && Array.isArray(current);
      if (normalizeIncomingArray(array, value, current, unwrapArray)) {
        createRenderEffect(() => current = insertExpression(parent, array, current, marker, true));
        return () => current;
      }
      if (sharedConfig.context) {
        if (!array.length) return current;
        for (let i = 0; i < array.length; i++) {
          if (array[i].parentNode) return current = array;
        }
      }
      if (array.length === 0) {
        current = cleanChildren(parent, current, marker);
        if (multi) return current;
      } else if (currentArray) {
        if (current.length === 0) {
          appendNodes(parent, array, marker);
        } else reconcileArrays(parent, current, array);
      } else {
        current && cleanChildren(parent);
        appendNodes(parent, array);
      }
      current = array;
    } else if (value instanceof Node) {
      if (sharedConfig.context && value.parentNode) return current = multi ? [value] : value;
      if (Array.isArray(current)) {
        if (multi) return current = cleanChildren(parent, current, marker, value);
        cleanChildren(parent, current, null, value);
      } else if (current == null || current === "" || !parent.firstChild) {
        parent.appendChild(value);
      } else parent.replaceChild(value, parent.firstChild);
      current = value;
    } else ;
    return current;
  }
  function normalizeIncomingArray(normalized, array, current, unwrap) {
    let dynamic = false;
    for (let i = 0, len = array.length; i < len; i++) {
      let item = array[i],
        prev = current && current[i];
      if (item instanceof Node) {
        normalized.push(item);
      } else if (item == null || item === true || item === false) ; else if (Array.isArray(item)) {
        dynamic = normalizeIncomingArray(normalized, item, prev) || dynamic;
      } else if ((typeof item) === "function") {
        if (unwrap) {
          while (typeof item === "function") item = item();
          dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item], Array.isArray(prev) ? prev : [prev]) || dynamic;
        } else {
          normalized.push(item);
          dynamic = true;
        }
      } else {
        const value = String(item);
        if (prev && prev.nodeType === 3 && prev.data === value) {
          normalized.push(prev);
        } else normalized.push(document.createTextNode(value));
      }
    }
    return dynamic;
  }
  function appendNodes(parent, array, marker = null) {
    for (let i = 0, len = array.length; i < len; i++) parent.insertBefore(array[i], marker);
  }
  function cleanChildren(parent, current, marker, replacement) {
    if (marker === undefined) return parent.textContent = "";
    const node = replacement || document.createTextNode("");
    if (current.length) {
      let inserted = false;
      for (let i = current.length - 1; i >= 0; i--) {
        const el = current[i];
        if (node !== el) {
          const isParent = el.parentNode === parent;
          if (!inserted && !i) isParent ? parent.replaceChild(node, el) : parent.insertBefore(node, marker);else isParent && el.remove();
        } else inserted = true;
      }
    } else parent.insertBefore(node, marker);
    return [node];
  }

  let wasm;
  const heap = new Array(128).fill(undefined);
  heap.push(undefined, null, true, false);
  function getObject(idx) {
    return heap[idx];
  }
  let heap_next = heap.length;
  function dropObject(idx) {
    if (idx < 132) return;
    heap[idx] = heap_next;
    heap_next = idx;
  }
  function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
  }
  const cachedTextDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', {
    ignoreBOM: true,
    fatal: true
  }) : {
    decode: () => {
      throw Error('TextDecoder not available');
    }
  };
  if (typeof TextDecoder !== 'undefined') {
    cachedTextDecoder.decode();
  }
  let cachedUint8Memory0 = null;
  function getUint8Memory0() {
    if (cachedUint8Memory0 === null || cachedUint8Memory0.byteLength === 0) {
      cachedUint8Memory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8Memory0;
  }
  function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));
  }
  function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];
    heap[idx] = obj;
    return idx;
  }
  function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
      return `${val}`;
    }
    if (type == 'string') {
      return `"${val}"`;
    }
    if (type == 'symbol') {
      const description = val.description;
      if (description == null) {
        return 'Symbol';
      } else {
        return `Symbol(${description})`;
      }
    }
    if (type == 'function') {
      const name = val.name;
      if (typeof name == 'string' && name.length > 0) {
        return `Function(${name})`;
      } else {
        return 'Function';
      }
    }
    // objects
    if (Array.isArray(val)) {
      const length = val.length;
      let debug = '[';
      if (length > 0) {
        debug += debugString(val[0]);
      }
      for (let i = 1; i < length; i++) {
        debug += ', ' + debugString(val[i]);
      }
      debug += ']';
      return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches.length > 1) {
      className = builtInMatches[1];
    } else {
      // Failed to match the standard '[object ClassName]'
      return toString.call(val);
    }
    if (className == 'Object') {
      // we're a user defined class or Object
      // JSON.stringify avoids problems with cycles, and is generally much
      // easier than looping through ownProperties of `val`.
      try {
        return 'Object(' + JSON.stringify(val) + ')';
      } catch (_) {
        return 'Object';
      }
    }
    // errors
    if (val instanceof Error) {
      return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
  }
  let WASM_VECTOR_LEN = 0;
  const cachedTextEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : {
    encode: () => {
      throw Error('TextEncoder not available');
    }
  };
  const encodeString = typeof cachedTextEncoder.encodeInto === 'function' ? function (arg, view) {
    return cachedTextEncoder.encodeInto(arg, view);
  } : function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
      read: arg.length,
      written: buf.length
    };
  };
  function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
      const buf = cachedTextEncoder.encode(arg);
      const ptr = malloc(buf.length, 1) >>> 0;
      getUint8Memory0().subarray(ptr, ptr + buf.length).set(buf);
      WASM_VECTOR_LEN = buf.length;
      return ptr;
    }
    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;
    const mem = getUint8Memory0();
    let offset = 0;
    for (; offset < len; offset++) {
      const code = arg.charCodeAt(offset);
      if (code > 0x7F) break;
      mem[ptr + offset] = code;
    }
    if (offset !== len) {
      if (offset !== 0) {
        arg = arg.slice(offset);
      }
      ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
      const view = getUint8Memory0().subarray(ptr + offset, ptr + len);
      const ret = encodeString(arg, view);
      offset += ret.written;
      ptr = realloc(ptr, len, offset, 1) >>> 0;
    }
    WASM_VECTOR_LEN = offset;
    return ptr;
  }
  let cachedInt32Memory0 = null;
  function getInt32Memory0() {
    if (cachedInt32Memory0 === null || cachedInt32Memory0.byteLength === 0) {
      cachedInt32Memory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32Memory0;
  }
  /**
  * @param {number} cols
  * @param {number} rows
  * @param {boolean} resizable
  * @param {number} scrollback_limit
  * @returns {VtWrapper}
  */
  function create$1(cols, rows, resizable, scrollback_limit) {
    const ret = wasm.create(cols, rows, resizable, scrollback_limit);
    return VtWrapper.__wrap(ret);
  }
  let cachedUint32Memory0 = null;
  function getUint32Memory0() {
    if (cachedUint32Memory0 === null || cachedUint32Memory0.byteLength === 0) {
      cachedUint32Memory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32Memory0;
  }
  function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32Memory0().subarray(ptr / 4, ptr / 4 + len);
  }
  const VtWrapperFinalization = typeof FinalizationRegistry === 'undefined' ? {
    register: () => {},
    unregister: () => {}
  } : new FinalizationRegistry(ptr => wasm.__wbg_vtwrapper_free(ptr >>> 0));
  /**
  */
  class VtWrapper {
    static __wrap(ptr) {
      ptr = ptr >>> 0;
      const obj = Object.create(VtWrapper.prototype);
      obj.__wbg_ptr = ptr;
      VtWrapperFinalization.register(obj, obj.__wbg_ptr, obj);
      return obj;
    }
    __destroy_into_raw() {
      const ptr = this.__wbg_ptr;
      this.__wbg_ptr = 0;
      VtWrapperFinalization.unregister(this);
      return ptr;
    }
    free() {
      const ptr = this.__destroy_into_raw();
      wasm.__wbg_vtwrapper_free(ptr);
    }
    /**
    * @param {string} s
    * @returns {any}
    */
    feed(s) {
      const ptr0 = passStringToWasm0(s, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len0 = WASM_VECTOR_LEN;
      const ret = wasm.vtwrapper_feed(this.__wbg_ptr, ptr0, len0);
      return takeObject(ret);
    }
    /**
    * @returns {string}
    */
    inspect() {
      let deferred1_0;
      let deferred1_1;
      try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.vtwrapper_inspect(retptr, this.__wbg_ptr);
        var r0 = getInt32Memory0()[retptr / 4 + 0];
        var r1 = getInt32Memory0()[retptr / 4 + 1];
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
      } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
      }
    }
    /**
    * @returns {Uint32Array}
    */
    get_size() {
      try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.vtwrapper_get_size(retptr, this.__wbg_ptr);
        var r0 = getInt32Memory0()[retptr / 4 + 0];
        var r1 = getInt32Memory0()[retptr / 4 + 1];
        var v1 = getArrayU32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_free(r0, r1 * 4, 4);
        return v1;
      } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
      }
    }
    /**
    * @param {number} l
    * @returns {any}
    */
    get_line(l) {
      const ret = wasm.vtwrapper_get_line(this.__wbg_ptr, l);
      return takeObject(ret);
    }
    /**
    * @returns {any}
    */
    get_cursor() {
      const ret = wasm.vtwrapper_get_cursor(this.__wbg_ptr);
      return takeObject(ret);
    }
  }
  async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
      if (typeof WebAssembly.instantiateStreaming === 'function') {
        try {
          return await WebAssembly.instantiateStreaming(module, imports);
        } catch (e) {
          if (module.headers.get('Content-Type') != 'application/wasm') {
            console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
          } else {
            throw e;
          }
        }
      }
      const bytes = await module.arrayBuffer();
      return await WebAssembly.instantiate(bytes, imports);
    } else {
      const instance = await WebAssembly.instantiate(module, imports);
      if (instance instanceof WebAssembly.Instance) {
        return {
          instance,
          module
        };
      } else {
        return instance;
      }
    }
  }
  function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbindgen_object_drop_ref = function (arg0) {
      takeObject(arg0);
    };
    imports.wbg.__wbindgen_error_new = function (arg0, arg1) {
      const ret = new Error(getStringFromWasm0(arg0, arg1));
      return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_object_clone_ref = function (arg0) {
      const ret = getObject(arg0);
      return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_number_new = function (arg0) {
      const ret = arg0;
      return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_bigint_from_u64 = function (arg0) {
      const ret = BigInt.asUintN(64, arg0);
      return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_string_new = function (arg0, arg1) {
      const ret = getStringFromWasm0(arg0, arg1);
      return addHeapObject(ret);
    };
    imports.wbg.__wbg_set_f975102236d3c502 = function (arg0, arg1, arg2) {
      getObject(arg0)[takeObject(arg1)] = takeObject(arg2);
    };
    imports.wbg.__wbg_new_b525de17f44a8943 = function () {
      const ret = new Array();
      return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_f841cc6f2098f4b5 = function () {
      const ret = new Map();
      return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_f9876326328f45ed = function () {
      const ret = new Object();
      return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_is_string = function (arg0) {
      const ret = typeof getObject(arg0) === 'string';
      return ret;
    };
    imports.wbg.__wbg_set_17224bc548dd1d7b = function (arg0, arg1, arg2) {
      getObject(arg0)[arg1 >>> 0] = takeObject(arg2);
    };
    imports.wbg.__wbg_set_388c4c6422704173 = function (arg0, arg1, arg2) {
      const ret = getObject(arg0).set(getObject(arg1), getObject(arg2));
      return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_debug_string = function (arg0, arg1) {
      const ret = debugString(getObject(arg1));
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len1 = WASM_VECTOR_LEN;
      getInt32Memory0()[arg0 / 4 + 1] = len1;
      getInt32Memory0()[arg0 / 4 + 0] = ptr1;
    };
    imports.wbg.__wbindgen_throw = function (arg0, arg1) {
      throw new Error(getStringFromWasm0(arg0, arg1));
    };
    return imports;
  }
  function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedInt32Memory0 = null;
    cachedUint32Memory0 = null;
    cachedUint8Memory0 = null;
    return wasm;
  }
  function initSync(module) {
    if (wasm !== undefined) return wasm;
    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
      module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
  }
  async function __wbg_init(input) {
    if (wasm !== undefined) return wasm;
    const imports = __wbg_get_imports();
    if (typeof input === 'string' || typeof Request === 'function' && input instanceof Request || typeof URL === 'function' && input instanceof URL) {
      input = fetch(input);
    }
    const {
      instance,
      module
    } = await __wbg_load(await input, imports);
    return __wbg_finalize_init(instance, module);
  }

  var exports$1 = /*#__PURE__*/Object.freeze({
    __proto__: null,
    VtWrapper: VtWrapper,
    create: create$1,
    default: __wbg_init,
    initSync: initSync
  });

  const base64codes = [62,0,0,0,63,52,53,54,55,56,57,58,59,60,61,0,0,0,0,0,0,0,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,0,0,0,0,0,0,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51];

          function getBase64Code(charCode) {
              return base64codes[charCode - 43];
          }

          function base64_decode(str) {
              let missingOctets = str.endsWith("==") ? 2 : str.endsWith("=") ? 1 : 0;
              let n = str.length;
              let result = new Uint8Array(3 * (n / 4));
              let buffer;

              for (let i = 0, j = 0; i < n; i += 4, j += 3) {
                  buffer =
                      getBase64Code(str.charCodeAt(i)) << 18 |
                      getBase64Code(str.charCodeAt(i + 1)) << 12 |
                      getBase64Code(str.charCodeAt(i + 2)) << 6 |
                      getBase64Code(str.charCodeAt(i + 3));
                  result[j] = buffer >> 16;
                  result[j + 1] = (buffer >> 8) & 0xFF;
                  result[j + 2] = buffer & 0xFF;
              }

              return result.subarray(0, result.length - missingOctets);
          }

          const wasm_code = base64_decode("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IAMhAAwCCyAHIANBAWoiA0cNAAsgAiEEDAILIAAgBGoiBkEBaiEEAkAgAiAGTQ0AIAAgBWotAABBCkcNAEEAIQUgBCIGIQAMAwsgAiAETw0ACwtBASEFIAIiACAIIgZHDQBBAA8LAkAgDC0AAEUNACALQejnwABBBCAKKAIMEQEARQ0AQQEPCyAAIAhrIQdBACEDIAAgCEcEQCAAIA1qLQAAQQpGIQMLIAEgCGohACAMIAM6AAAgBiEIIAsgACAHIAooAgwRAQAiACAFckUNAAsgAAvSBgEFfyMAQcABayICJAAgACgCACEDIAJBuAFqQeCEwAA2AgAgAkEEaiIAQawBakHohsAANgIAIABBpAFqQYiHwAA2AgAgAEGcAWpB+IbAADYCACACQZgBakH4hsAANgIAIAJBkAFqQaCCwAA2AgAgAkGIAWpBoILAADYCACACQYABakHohsAANgIAIABB9ABqQeiGwAA2AgAgAkHwAGpB6IbAADYCACACQegAakHohsAANgIAIABB3ABqQeiGwAA2AgAgAkHYAGpB2IbAADYCACACQdAAakGggsAANgIAIAJByABqQciGwAA2AgAgAkFAa0G4hsAANgIAIAJBOGpBqIbAADYCACACQTBqQZiGwAA2AgAgAEEkakGIhsAANgIAIAJBIGpB+IXAADYCACACQRhqQfiFwAA2AgAgAkEQakGggsAANgIAIAIgA0HCAWo2AqwBIAIgA0HcAGo2AqQBIAIgA0GIAWo2ApwBIAIgA0H0AGo2ApQBIAIgA0GsAWo2AowBIAIgA0GoAWo2AoQBIAIgA0HBAWo2AnwgAiADQcABajYCdCACIANBvwFqNgJsIAIgA0G+AWo2AmQgAiADQb0BajYCXCACIANB0ABqNgJUIAIgA0GkAWo2AkwgAiADQbABajYCRCACIANBsgFqNgI8IAIgA0HoAGo2AjQgAiADQcgAajYCLCACIANBvAFqNgIkIAIgA0EkajYCHCACIAM2AhQgAiADQaABajYCDCACQaCCwAA2AgggAiADQZwBajYCBCACIANBwwFqNgK8ASACIAJBvAFqNgK0AUEXIQZB9IjAACEEIwBBIGsiAyQAIANBFzYCACADQRc2AgQgASgCFEGYh8AAQQggASgCGCgCDBEBACEFIANBADoADSADIAU6AAwgAyABNgIIAn8DQCADQQhqIAQoAgAgBEEEaigCACAAQYjqwAAQICEFIABBCGohACAEQQhqIQQgBkEBayIGDQALIAMtAAwhASABQQBHIAMtAA1FDQAaQQEgAQ0AGiAFKAIAIgAtABxBBHFFBEAgACgCFEH358AAQQIgACgCGCgCDBEBAAwBCyAAKAIUQfbnwABBASAAKAIYKAIMEQEACyADQSBqJAAgAkHAAWokAAv4AwECfyAAIAFqIQICQAJAIAAoAgQiA0EBcQ0AIANBAnFFDQEgACgCACIDIAFqIQEgACADayIAQZCDwQAoAgBGBEAgAigCBEEDcUEDRw0BQYiDwQAgATYCACACIAIoAgRBfnE2AgQgACABQQFyNgIEIAIgATYCAAwCCyAAIAMQHwsCQAJAAkAgAigCBCIDQQJxRQRAIAJBlIPBACgCAEYNAiACQZCDwQAoAgBGDQMgAiADQXhxIgIQHyAAIAEgAmoiAUEBcjYCBCAAIAFqIAE2AgAgAEGQg8EAKAIARw0BQYiDwQAgATYCAA8LIAIgA0F+cTYCBCAAIAFBAXI2AgQgACABaiABNgIACyABQYACTwRAIAAgARAkDwsgAUF4cUH4gMEAaiECAn9BgIPBACgCACIDQQEgAUEDdnQiAXFFBEBBgIPBACABIANyNgIAIAIMAQsgAigCCAshASACIAA2AgggASAANgIMIAAgAjYCDCAAIAE2AggPC0GUg8EAIAA2AgBBjIPBAEGMg8EAKAIAIAFqIgE2AgAgACABQQFyNgIEIABBkIPBACgCAEcNAUGIg8EAQQA2AgBBkIPBAEEANgIADwtBkIPBACAANgIAQYiDwQBBiIPBACgCACABaiIBNgIAIAAgAUEBcjYCBCAAIAFqIAE2AgALC8IDAQR/IwBBEGsiAyQAAkACQCAAKAKkASICQQFNBEACQCAAIAJqQbABai0AAEUNACABQeAAayICQR5LDQAgAkECdEGIo8AAaigCACEBCyADQQxqIABBugFqLwEAOwEAIAMgATYCACADIAApAbIBNwIEIAAtAL8BRQ0CIAAtAMEBRQ0CIABBADoAwQEgAEEANgJoIAAoAmwiASAAKAKsAUYNASABIAAoAqABQQFrTw0CIAAgAUHgm8AAEHlBAToADCAAQQA6AMEBIAAgAUEBajYCbCAAQQA2AmgMAgsgAkECQcygwAAQXwALIAAgAUHgm8AAEHlBAToADCAAQQEQnwELAkAgAAJ/IAAoAmgiAkEBaiIBIAAoApwBIgRJBEAgACgCbCEEAkAgAC0AvQFFBEAgACACIAQgAxB8DAELIAAoAhghBSAAIARB8JvAABB5IAIgAiAFRyADEEQLQQAMAQsgACAEQQFrIAAoAmwgAxB8IAAtAL8BRQ0BIAAoApwBIQFBAQs6AMEBIAAgATYCaAsgACgCZCICIAAoAmwiAUsEQCAAKAJgIAFqQQE6AAAgA0EQaiQADwsgASACQeykwAAQXwAL5wIBBX8CQEHN/3sgAEEQIABBEEsbIgBrIAFNDQBBECABQQtqQXhxIAFBC0kbIgQgAGpBDGoQDyICRQ0AIAJBCGshAQJAIABBAWsiAyACcUUEQCABIQAMAQsgAkEEayIFKAIAIgZBeHFBACAAIAIgA2pBACAAa3FBCGsiACABa0EQSxsgAGoiACABayICayEDIAZBA3EEQCAAIAMgACgCBEEBcXJBAnI2AgQgACADaiIDIAMoAgRBAXI2AgQgBSACIAUoAgBBAXFyQQJyNgIAIAEgAmoiAyADKAIEQQFyNgIEIAEgAhAaDAELIAEoAgAhASAAIAM2AgQgACABIAJqNgIACwJAIAAoAgQiAUEDcUUNACABQXhxIgIgBEEQak0NACAAIAQgAUEBcXJBAnI2AgQgACAEaiIBIAIgBGsiBEEDcjYCBCAAIAJqIgIgAigCBEEBcjYCBCABIAQQGgsgAEEIaiEDCyADC4sDAQd/IwBBEGsiBCQAAkACQAJAAkACQAJAIAEoAgQiAkUNACABKAIAIQUgAkEDcSEGAkAgAkEESQRAQQAhAgwBCyAFQRxqIQMgAkF8cSEIQQAhAgNAIAMoAgAgA0EIaygCACADQRBrKAIAIANBGGsoAgAgAmpqamohAiADQSBqIQMgCCAHQQRqIgdHDQALCyAGBEAgB0EDdCAFakEEaiEDA0AgAygCACACaiECIANBCGohAyAGQQFrIgYNAAsLIAEoAgwEQCACQQBIDQEgBSgCBEUgAkEQSXENASACQQF0IQILIAINAQtBASEDQQAhAgwBCyACQQBIDQFBmf/AAC0AABogAkEBEMgBIgNFDQILIARBADYCCCAEIAM2AgQgBCACNgIAIARB9OHAACABEBdFDQJB1OLAAEEzIARBD2pBiOPAAEGw48AAEFYACxCXAQALQQEgAkHU/8AAKAIAIgBB1wAgABsRAgAACyAAIAQpAgA3AgAgAEEIaiAEQQhqKAIANgIAIARBEGokAAvVAgEHf0EBIQkCQAJAIAJFDQAgASACQQF0aiEKIABBgP4DcUEIdiELIABB/wFxIQ0DQCABQQJqIQwgByABLQABIgJqIQggCyABLQAAIgFHBEAgASALSw0CIAghByAKIAwiAUYNAgwBCwJAAkAgByAITQRAIAQgCEkNASADIAdqIQEDQCACRQ0DIAJBAWshAiABLQAAIAFBAWohASANRw0AC0EAIQkMBQsgByAIQajswAAQ3AEACyAIIARBqOzAABDaAQALIAghByAKIAwiAUcNAAsLIAZFDQAgBSAGaiEDIABB//8DcSEBA0AgBUEBaiEAAkAgBS0AACICwCIEQQBOBEAgACEFDAELIAAgA0cEQCAFLQABIARB/wBxQQh0ciECIAVBAmohBQwBC0GY7MAAEN4BAAsgASACayIBQQBIDQEgCUEBcyEJIAMgBUcNAAsLIAlBAXEL8wIBBH8gACgCDCECAkACQCABQYACTwRAIAAoAhghAwJAAkAgACACRgRAIABBFEEQIAAoAhQiAhtqKAIAIgENAUEAIQIMAgsgACgCCCIBIAI2AgwgAiABNgIIDAELIABBFGogAEEQaiACGyEEA0AgBCEFIAEiAigCFCEBIAJBFGogAkEQaiABGyEEIAJBFEEQIAEbaigCACIBDQALIAVBADYCAAsgA0UNAiAAIAAoAhxBAnRB6P/AAGoiASgCAEcEQCADQRBBFCADKAIQIABGG2ogAjYCACACRQ0DDAILIAEgAjYCACACDQFBhIPBAEGEg8EAKAIAQX4gACgCHHdxNgIADAILIAIgACgCCCIARwRAIAAgAjYCDCACIAA2AggPC0GAg8EAQYCDwQAoAgBBfiABQQN2d3E2AgAPCyACIAM2AhggACgCECIBBEAgAiABNgIQIAEgAjYCGAsgACgCFCIARQ0AIAIgADYCFCAAIAI2AhgLC4EDAgV/AX4jAEFAaiIFJABBASEHAkAgAC0ABA0AIAAtAAUhCCAAKAIAIgYoAhwiCUEEcUUEQCAGKAIUQe/nwABB7OfAACAIG0ECQQMgCBsgBigCGCgCDBEBAA0BIAYoAhQgASACIAYoAhgoAgwRAQANASAGKAIUQbznwABBAiAGKAIYKAIMEQEADQEgAyAGIAQoAgwRAAAhBwwBCyAIRQRAIAYoAhRB8efAAEEDIAYoAhgoAgwRAQANASAGKAIcIQkLIAVBAToAGyAFIAYpAhQ3AgwgBUHQ58AANgI0IAUgBUEbajYCFCAFIAYpAgg3AiQgBikCACEKIAUgCTYCOCAFIAYoAhA2AiwgBSAGLQAgOgA8IAUgCjcCHCAFIAVBDGoiBjYCMCAGIAEgAhAYDQAgBUEMakG858AAQQIQGA0AIAMgBUEcaiAEKAIMEQAADQAgBSgCMEH058AAQQIgBSgCNCgCDBEBACEHCyAAQQE6AAUgACAHOgAEIAVBQGskACAAC+UDAQV/IwBBMGsiBSQAIAIgAWsiCCADSyEJIAJBAWsiBiAAKAIcIgdBAWtJBEAgACAGQfCcwAAQeUEAOgAMCyADIAggCRshAwJAAkAgAUUEQCACIAdGDQEgACgCGCEGIAVBIGoiAUEMaiAEQQhqLwAAOwEAIAVBIDYCICAFIAQpAAA3AiQgBUEQaiABIAYQSSAFQQA6ABwgAwRAIABBDGohBCAAKAIUIAJqIAAoAhxrIQIDQCAFQSBqIgEgBUEQahBYIAVBADoALCAEKAIIIgcgBCgCAEYEQCAEIAdBARB4CyAEKAIEIAJBBHRqIQYCQCACIAdPBEAgAiAHRg0BIAIgBxBeAAsgBkEQaiAGIAcgAmtBBHQQ9QELIAYgASkCADcCACAEIAdBAWo2AgggBkEIaiABQQhqKQIANwIAIANBAWsiAw0ACwsgBSgCECIBRQ0CIAUoAhQgAUEEdBDUAQwCCyAAIAFBAWtBgJ3AABB5QQA6AAwgBUEIaiAAIAEgAkGQncAAEFkgBSgCCCEGIAUoAgwiASADSQRAQYylwABBI0H8pcAAEIwBAAsgAyAGIANBBHRqIAEgA2sQEiAAIAIgA2sgAiAEEEMMAQsgACADIAAoAhgQaAsgAEEBOgAgIAVBMGokAAuGBAEFfyMAQRBrIgMkAAJAAn8CQCABQYABTwRAIANBADYCDCABQYAQSQ0BIAFBgIAESQRAIAMgAUE/cUGAAXI6AA4gAyABQQx2QeABcjoADCADIAFBBnZBP3FBgAFyOgANQQMMAwsgAyABQT9xQYABcjoADyADIAFBBnZBP3FBgAFyOgAOIAMgAUEMdkE/cUGAAXI6AA0gAyABQRJ2QQdxQfABcjoADEEEDAILIAAoAggiAiAAKAIARgRAIwBBIGsiBCQAAkACQCACQQFqIgJFDQAgACgCACIFQQF0IgYgAiACIAZJGyICQQggAkEISxsiAkF/c0EfdiEGIAQgBQR/IAQgBTYCHCAEIAAoAgQ2AhRBAQVBAAs2AhggBEEIaiAGIAIgBEEUahBCIAQoAggEQCAEKAIMIgBFDQEgACAEKAIQQdT/wAAoAgAiAEHXACAAGxECAAALIAQoAgwhBSAAIAI2AgAgACAFNgIEIARBIGokAAwBCxCXAQALIAAoAgghAgsgACACQQFqNgIIIAAoAgQgAmogAToAAAwCCyADIAFBP3FBgAFyOgANIAMgAUEGdkHAAXI6AAxBAgshASABIAAoAgAgACgCCCICa0sEQCAAIAIgARA4IAAoAgghAgsgACgCBCACaiADQQxqIAEQ9wEaIAAgASACajYCCAsgA0EQaiQAQQALwAICBX8BfiMAQTBrIgQkAEEnIQICQCAAQpDOAFQEQCAAIQcMAQsDQCAEQQlqIAJqIgNBBGsgACAAQpDOAIAiB0KQzgB+faciBUH//wNxQeQAbiIGQQF0Qa7owABqLwAAOwAAIANBAmsgBSAGQeQAbGtB//8DcUEBdEGu6MAAai8AADsAACACQQRrIQIgAEL/wdcvViAHIQANAAsLIAenIgNB4wBLBEAgB6ciBUH//wNxQeQAbiEDIAJBAmsiAiAEQQlqaiAFIANB5ABsa0H//wNxQQF0Qa7owABqLwAAOwAACwJAIANBCk8EQCACQQJrIgIgBEEJamogA0EBdEGu6MAAai8AADsAAAwBCyACQQFrIgIgBEEJamogA0EwcjoAAAsgAUHI5MAAQQAgBEEJaiACakEnIAJrEBQgBEEwaiQAC8QCAQR/IABCADcCECAAAn9BACABQYACSQ0AGkEfIAFB////B0sNABogAUEGIAFBCHZnIgNrdkEBcSADQQF0a0E+agsiAjYCHCACQQJ0Qej/wABqIQRBASACdCIDQYSDwQAoAgBxRQRAIAQgADYCACAAIAQ2AhggACAANgIMIAAgADYCCEGEg8EAQYSDwQAoAgAgA3I2AgAPCwJAAkAgASAEKAIAIgMoAgRBeHFGBEAgAyECDAELIAFBAEEZIAJBAXZrIAJBH0YbdCEFA0AgAyAFQR12QQRxakEQaiIEKAIAIgJFDQIgBUEBdCEFIAIhAyACKAIEQXhxIAFHDQALCyACKAIIIgEgADYCDCACIAA2AgggAEEANgIYIAAgAjYCDCAAIAE2AggPCyAEIAA2AgAgACADNgIYIAAgADYCDCAAIAA2AggLlAQBA38CQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAIAFBCGsOCAECAwQFDQYHAAsgAUGEAWsOCgcICwsJCwsLCwoLCyAALQDBASEBIABBADoAwQEgAEEAIAAoAmhBfkF/IAEbaiIBIAAoApwBIgBBAWsgACABSxsgAUEASBs2AmgPCyAAKAJYQQJ0IQEgACgCVCECIAAoAmghBAJAAkADQCABRQ0BIAFBBGshASACKAIAIQMgAkEEaiECIAMgBE0NAAsgACgCnAEiAUEBayECDAELIAAoApwBIgFBAWsiAiEDCyAAQQA6AMEBIAAgAyACIAEgA0sbNgJoDwsgABBpIAAtAMABRQ0IDAkLIAAQaSAALQDAAUUNBwwICyAAEGkgAC0AwAFFDQYMBwsgAEEBNgKkAQ8LIABBADYCpAEPCyAAEGkgAC0AwAFFDQMMBAsgABBpDAMLIAAoAmgiAUUNASABIAAoApwBTw0BIABB0ABqIAEQUQ8LAkAgACgCbCIBIAAoAqgBIgJHBEAgAQRAIABBADoAwQEgACAAKAJoIgMgACgCnAFBAWsiBCADIARJGzYCaCAAIAEgAkEAIAAtAL4BIgIbIgFqQQFrIgMgASABIANJGyIBIAAoAqwBIAAoAqABQQFrIAIbIgAgACABSxs2AmwLDAELIABBARCgAQsLDwsgAEEAOgDBASAAQQA2AmgLyQ0CCn8BfiMAQRBrIgIkAEEBIQsCQAJAIAEoAhQiCUEnIAEoAhgoAhAiChEAAA0AIAAoAgAhAyMAQSBrIgQkAAJAAkACQAJAAkACQAJAAkACQAJAAkACQCADDigGAQEBAQEBAQECBAEBAwEBAQEBAQEBAQEBAQEBAQEBAQEBCAEBAQEHAAsgA0HcAEYNBAsgA0GAAUkNBiADQQt0IQVBISEAQSEhBwJAA0AgAEEBdiAGaiIBQQJ0Qbz4wABqKAIAQQt0IgAgBUcEQCABIAcgACAFSxsiByABQQFqIAYgACAFSRsiBmshACAGIAdJDQEMAgsLIAFBAWohBgsCQAJAIAZBIE0EQCAGQQJ0IgBBvPjAAGooAgBB1wUhBwJAIAZBIEYNACAAQcD4wABqIgBFDQAgACgCAEEVdiEHC0EVdiEBIAYEfyAGQQJ0Qbj4wABqKAIAQf///wBxBUEACyEAAkAgByABQX9zakUNACADIABrIQUgAUHXBSABQdcFSxshCCAHQQFrIQBBACEGA0AgASAIRg0DIAUgBiABQcD5wABqLQAAaiIGSQ0BIAAgAUEBaiIBRw0ACyAAIQELIAFBAXEhAAwCCyAGQSFB3PfAABBfAAsgCEHXBUHs98AAEF8ACyAARQ0GIARBGGpBADoAACAEQQA7ARYgBEH9ADoAHyAEIANBD3FB5OTAAGotAAA6AB4gBCADQQR2QQ9xQeTkwABqLQAAOgAdIAQgA0EIdkEPcUHk5MAAai0AADoAHCAEIANBDHZBD3FB5OTAAGotAAA6ABsgBCADQRB2QQ9xQeTkwABqLQAAOgAaIAQgA0EUdkEPcUHk5MAAai0AADoAGSADQQFyZ0ECdkECayIFQQtPDQcgBEEWaiIBIAVqIgBBqPjAAC8AADsAACAAQQJqQar4wAAtAAA6AAAgBEEQaiABQQhqLwEAIgA7AQAgBCAEKQEWIgw3AwggAkEIaiAAOwEAIAIgDDcCACACQQo6AAsgAiAFOgAKDAkLIAJBgAQ7AQogAkIANwECIAJB3OgBOwEADAgLIAJBgAQ7AQogAkIANwECIAJB3OQBOwEADAcLIAJBgAQ7AQogAkIANwECIAJB3NwBOwEADAYLIAJBgAQ7AQogAkIANwECIAJB3LgBOwEADAULIAJBgAQ7AQogAkIANwECIAJB3OAAOwEADAQLIAJBgAQ7AQogAkIANwECIAJB3M4AOwEADAMLAn8CQCADQSBJDQACQAJ/QQEgA0H/AEkNABogA0GAgARJDQECQCADQYCACE8EQCADQbDHDGtB0LorSQ0EIANBy6YMa0EFSQ0EIANBnvQLa0HiC0kNBCADQeHXC2tBnxhJDQQgA0GinQtrQQ5JDQQgA0F+cUGe8ApGDQQgA0FgcUHgzQpHDQEMBAsgA0G47MAAQSxBkO3AAEHEAUHU7sAAQcIDEB4MBAtBACADQbruCmtBBkkNABogA0GAgMQAa0Hwg3RJCwwCCyADQZbywABBKEHm8sAAQZ8CQYX1wABBrwIQHgwBC0EACwRAIAIgAzYCBCACQYABOgAADAMLIARBGGpBADoAACAEQQA7ARYgBEH9ADoAHyAEIANBD3FB5OTAAGotAAA6AB4gBCADQQR2QQ9xQeTkwABqLQAAOgAdIAQgA0EIdkEPcUHk5MAAai0AADoAHCAEIANBDHZBD3FB5OTAAGotAAA6ABsgBCADQRB2QQ9xQeTkwABqLQAAOgAaIAQgA0EUdkEPcUHk5MAAai0AADoAGSADQQFyZ0ECdkECayIFQQtPDQEgBEEWaiIBIAVqIgBBqPjAAC8AADsAACAAQQJqQar4wAAtAAA6AAAgBEEQaiABQQhqLwEAIgA7AQAgBCAEKQEWIgw3AwggAkEIaiAAOwEAIAIgDDcCACACQQo6AAsgAiAFOgAKDAILIAVBCkGY+MAAENkBAAsgBUEKQZj4wAAQ2QEACyAEQSBqJAACQCACLQAAQYABRgRAIAJBCGohBUGAASEIA0ACQCAIQYABRwRAIAItAAoiACACLQALTw0EIAIgAEEBajoACiAAQQpPDQYgACACai0AACEBDAELQQAhCCAFQQA2AgAgAigCBCEBIAJCADcDAAsgCSABIAoRAABFDQALDAILIAItAAoiAUEKIAFBCksbIQAgASACLQALIgUgASAFSxshBwNAIAEgB0YNASACIAFBAWoiBToACiAAIAFGDQMgASACaiEIIAUhASAJIAgtAAAgChEAAEUNAAsMAQsgCUEnIAoRAAAhCwsgAkEQaiQAIAsPCyAAQQpBrPjAABBfAAvGAgACQAJAAkACQAJAAkACQCADQQFrDgYAAQIDBAUGCyAAKAIYIQMgACACQaCcwAAQeSIEQQA6AAwgBCABIAMgBRBMIAAgAkEBaiAAKAIcIAUQQw8LIAAoAhghAyAAIAJBsJzAABB5QQAgAUEBaiIBIAMgASADSRsgBRBMIABBACACIAUQQw8LIABBACAAKAIcIAUQQw8LIAAoAhghAyAAIAJBwJzAABB5IgAgASADIAUQTCAAQQA6AAwPCyAAKAIYIQMgACACQdCcwAAQeUEAIAFBAWoiACADIAAgA0kbIAUQTA8LIAAoAhghASAAIAJB4JzAABB5IgBBACABIAUQTCAAQQA6AAwPCyAAKAIYIQMgACACQZCcwAAQeSIAIAEgASAEIAMgAWsiASABIARLG2oiASAFEEwgASADRgRAIABBADoADAsLkgIBA38jAEEQayICJAACQAJ/AkAgAUGAAU8EQCACQQA2AgwgAUGAEEkNASABQYCABEkEQCACIAFBDHZB4AFyOgAMIAIgAUEGdkE/cUGAAXI6AA1BAiEDQQMMAwsgAiABQQZ2QT9xQYABcjoADiACIAFBDHZBP3FBgAFyOgANIAIgAUESdkEHcUHwAXI6AAxBAyEDQQQMAgsgACgCCCIEIAAoAgBGBH8gACAEEHUgACgCCAUgBAsgACgCBGogAToAACAAIAAoAghBAWo2AggMAgsgAiABQQZ2QcABcjoADEEBIQNBAgshBCADIAJBDGoiA3IgAUE/cUGAAXI6AAAgACADIAMgBGoQfgsgAkEQaiQAQQALpAIBBn8jAEEQayICJAACQAJAIAEoAhAiBSAAKAIAIAAoAggiA2tLBEAgACADIAUQeCAAKAIIIQMgACgCBCEEIAJBCGogAUEMaigCADYCACACIAEpAgQ3AwAMAQsgACgCBCEEIAJBCGogAUEMaigCADYCACACIAEpAgQ3AwAgBUUNAQsCQCABKAIAIgZBgIDEAEYNACAEIANBBHRqIgEgBjYCACABIAIpAwA3AgQgAUEMaiACQQhqIgcoAgA2AgAgBUEBayIERQRAIANBAWohAwwBCyADIAVqIQMgAUEUaiEBA0AgAUEEayAGNgIAIAEgAikDADcCACABQQhqIAcoAgA2AgAgAUEQaiEBIARBAWsiBA0ACwsgACADNgIICyACQRBqJAALnAUBCn8jAEEwayIGJAAgBkEAOwAOIAZBAjoACiAGQQI6AAYgBkEsaiAFIAZBBmogBRsiBUEIai8AADsBACAGQSA2AiAgBiAFKQAANwIkIAZBEGoiCSAGQSBqIgwgARBJIAZBADoAHCMAQRBrIgokAAJAAkACQAJAIAJFBEBBBCEHDAELIAJB////P0sNAUGZ/8AALQAAGiACQQR0IgVBBBDIASIHRQ0CCyAKQQRqIgVBCGoiDkEANgIAIAogBzYCCCAKIAI2AgQjAEEQayILJAAgAiAFKAIAIAUoAggiB2tLBEAgBSAHIAIQeCAFKAIIIQcLIAUoAgQgB0EEdGohCAJAAkAgAkECTwRAIAJBAWshDSAJLQAMIQ8DQCALIAkQWCAIIA86AAwgCEEIaiALQQhqKAIANgIAIAggCykDADcCACAIQRBqIQggDUEBayINDQALIAIgB2pBAWshBwwBCyACDQAgBSAHNgIIIAkoAgAiBUUNASAJKAIEIAVBBHQQ1AEMAQsgCCAJKQIANwIAIAUgB0EBajYCCCAIQQhqIAlBCGopAgA3AgALIAtBEGokACAMQQhqIA4oAgA2AgAgDCAKKQIENwIAIApBEGokAAwCCxCXAQALQQQgBUHU/8AAKAIAIgBB1wAgABsRAgAACwJAAkAgA0EBRgRAIARFDQEgBigCICAGKAIoIgVrIARPDQEgBkEgaiAFIAQQeAwBCyAGKAIgIAYoAigiBWtB5wdNBEAgBkEgaiAFQegHEHgLIAMNAAwBCyAEQQpuIARqIQULIAAgBikCIDcCDCAAIAI2AhwgACABNgIYIABBADoAICAAIAU2AgggACAENgIEIAAgAzYCACAAQRRqIAZBKGooAgA2AgAgBkEwaiQAC74CAgR/AX4jAEFAaiIDJABBASEFAkAgAC0ABA0AIAAtAAUhBQJAIAAoAgAiBCgCHCIGQQRxRQRAIAVFDQFBASEFIAQoAhRB7+fAAEECIAQoAhgoAgwRAQBFDQEMAgsgBUUEQEEBIQUgBCgCFEH958AAQQEgBCgCGCgCDBEBAA0CIAQoAhwhBgtBASEFIANBAToAGyADIAQpAhQ3AgwgA0HQ58AANgI0IAMgA0EbajYCFCADIAQpAgg3AiQgBCkCACEHIAMgBjYCOCADIAQoAhA2AiwgAyAELQAgOgA8IAMgBzcCHCADIANBDGo2AjAgASADQRxqIAIoAgwRAAANASADKAIwQfTnwABBAiADKAI0KAIMEQEAIQUMAQsgASAEIAIoAgwRAAAhBQsgAEEBOgAFIAAgBToABCADQUBrJAALkAIBA38jAEEQayICJAACQAJ/AkAgAUGAAU8EQCACQQA2AgwgAUGAEEkNASABQYCABEkEQCACIAFBDHZB4AFyOgAMIAIgAUEGdkE/cUGAAXI6AA1BAiEDQQMMAwsgAiABQQZ2QT9xQYABcjoADiACIAFBDHZBP3FBgAFyOgANIAIgAUESdkEHcUHwAXI6AAxBAyEDQQQMAgsgACgCCCIEIAAoAgBGBH8gACAEEHUgACgCCAUgBAsgACgCBGogAToAACAAIAAoAghBAWo2AggMAgsgAiABQQZ2QcABcjoADEEBIQNBAgshBCADIAJBDGoiA3IgAUE/cUGAAXI6AAAgACADIAQQywELIAJBEGokAEEAC7sCAgR/AX4jAEFAaiIDJAAgACgCACEFIAACf0EBIAAtAAgNABogACgCBCIEKAIcIgZBBHFFBEBBASAEKAIUQe/nwABB+efAACAFG0ECQQEgBRsgBCgCGCgCDBEBAA0BGiABIAQgAigCDBEAAAwBCyAFRQRAQQEgBCgCFEH658AAQQIgBCgCGCgCDBEBAA0BGiAEKAIcIQYLIANBAToAGyADIAQpAhQ3AgwgA0HQ58AANgI0IAMgA0EbajYCFCADIAQpAgg3AiQgBCkCACEHIAMgBjYCOCADIAQoAhA2AiwgAyAELQAgOgA8IAMgBzcCHCADIANBDGo2AjBBASABIANBHGogAigCDBEAAA0AGiADKAIwQfTnwABBAiADKAI0KAIMEQEACzoACCAAIAVBAWo2AgAgA0FAayQAIAAL+gEBBH8gACgCBCECIABBiKPAADYCBCAAKAIAIQEgAEGIo8AANgIAIAAoAgghAwJAAkAgASACRgRAIAAoAhAiAUUNASAAKAIMIgIgAygCCCIARg0CIAMoAgQiBCAAQQR0aiAEIAJBBHRqIAFBBHQQ9QEMAgsgAiABa0EEdiECA0AgASgCACIEBEAgAUEEaigCACAEQQR0ENQBCyABQRBqIQEgAkEBayICDQALIAAoAhAiAUUNACAAKAIMIgIgAygCCCIARwRAIAMoAgQiBCAAQQR0aiAEIAJBBHRqIAFBBHQQ9QELIAMgACABajYCCAsPCyADIAAgAWo2AggLigICBH8BfiMAQTBrIgIkACABKAIAQYCAgIB4RgRAIAEoAgwhAyACQSRqIgRBCGoiBUEANgIAIAJCgICAgBA3AiQgBEHg3cAAIAMQFxogAkEgaiAFKAIAIgM2AgAgAiACKQIkIgY3AxggAUEIaiADNgIAIAEgBjcCAAsgASkCACEGIAFCgICAgBA3AgAgAkEQaiIDIAFBCGoiASgCADYCACABQQA2AgBBmf/AAC0AABogAiAGNwMIQQxBBBDIASIBRQRAQQRBDEHU/8AAKAIAIgBB1wAgABsRAgAACyABIAIpAwg3AgAgAUEIaiADKAIANgIAIABBtODAADYCBCAAIAE2AgAgAkEwaiQAC9kBAQV/IwBBIGsiAyQAAn9BACACIAJBAWoiAksNABpBBCEEIAEoAgAiBkEBdCIFIAIgAiAFSRsiAkEEIAJBBEsbIgVBAnQhByACQYCAgIACSUECdCECAkAgBkUEQEEAIQQMAQsgAyAGQQJ0NgIcIAMgASgCBDYCFAsgAyAENgIYIANBCGogAiAHIANBFGoQQSADKAIIRQRAIAMoAgwhAiABIAU2AgAgASACNgIEQYGAgIB4DAELIAMoAhAhASADKAIMCyEEIAAgATYCBCAAIAQ2AgAgA0EgaiQAC9kBAQR/IwBBIGsiBCQAAn9BACACIAIgA2oiAksNABpBBCEDIAEoAgAiBkEBdCIFIAIgAiAFSRsiAkEEIAJBBEsbIgVBBHQhByACQYCAgMAASUECdCECAkAgBkUEQEEAIQMMAQsgBCAGQQR0NgIcIAQgASgCBDYCFAsgBCADNgIYIARBCGogAiAHIARBFGoQQSAEKAIIRQRAIAQoAgwhAiABIAU2AgAgASACNgIEQYGAgIB4DAELIAQoAhAhASAEKAIMCyECIAAgATYCBCAAIAI2AgAgBEEgaiQAC9wBAQF/IwBBEGsiFSQAIAAoAhQgASACIAAoAhgoAgwRAQAhASAVQQA6AA0gFSABOgAMIBUgADYCCCAVQQhqIAMgBCAFIAYQICAHIAggCUGggsAAECAgCiALIAwgDRAgIA4gDyAQIBEQICASIBMgFEHghMAAECAhAQJ/IBUtAAwiAkEARyAVLQANRQ0AGkEBIAINABogASgCACIALQAcQQRxRQRAIAAoAhRB9+fAAEECIAAoAhgoAgwRAQAMAQsgACgCFEH258AAQQEgACgCGCgCDBEBAAsgFUEQaiQAC5oBAQR/IwBBEGsiAiQAQQEhAwJAAkAgAQRAIAFBAEgNAkGZ/8AALQAAGiABQQEQyAEiA0UNAQsgAkEEaiIEQQhqIgVBADYCACACIAM2AgggAiABNgIEIAQgAUEBEE8gAEEIaiAFKAIANgIAIAAgAikCBDcCACACQRBqJAAPC0EBIAFB1P/AACgCACIAQdcAIAAbEQIAAAsQlwEAC4QCAQJ/IwBBIGsiBiQAQeT/wABB5P/AACgCACIHQQFqNgIAAkACQCAHQQBIDQBBsIPBAC0AAA0AQbCDwQBBAToAAEGsg8EAQayDwQAoAgBBAWo2AgAgBiAFOgAdIAYgBDoAHCAGIAM2AhggBiACNgIUIAZB/ODAADYCECAGQeDdwAA2AgxB2P/AACgCACICQQBIDQBB2P/AACACQQFqNgIAQdj/wABB3P/AACgCAAR/IAYgACABKAIQEQIAIAYgBikDADcCDEHc/8AAKAIAIAZBDGpB4P/AACgCACgCFBECAEHY/8AAKAIAQQFrBSACCzYCAEGwg8EAQQA6AAAgBA0BCwALAAvLAQEDfyMAQSBrIgQkAAJ/QQAgAiACIANqIgJLDQAaQQEhAyABKAIAIgZBAXQiBSACIAIgBUkbIgJBCCACQQhLGyICQX9zQR92IQUCQCAGRQRAQQAhAwwBCyAEIAY2AhwgBCABKAIENgIUCyAEIAM2AhggBEEIaiAFIAIgBEEUahBBIAQoAghFBEAgBCgCDCEDIAEgAjYCACABIAM2AgRBgYCAgHgMAQsgBCgCECEBIAQoAgwLIQIgACABNgIEIAAgAjYCACAEQSBqJAAL5wEBAn8jAEEQayIFJAAgACgCFEGggcAAQQMgACgCGCgCDBEBACEGIAVBADoADSAFIAY6AAwgBSAANgIIIAVBCGpBo4HAAEEKIAFBsIHAABAgQcCBwABBCiACQbCBwAAQIEHKgcAAQQkgA0HUgcAAECBB5IHAAEEFIARB7IHAABAgIQECfyAFLQAMIgJBAEcgBS0ADUUNABpBASACDQAaIAEoAgAiAC0AHEEEcUUEQCAAKAIUQffnwABBAiAAKAIYKAIMEQEADAELIAAoAhRB9ufAAEEBIAAoAhgoAgwRAQALIAVBEGokAAvHAQEBfyMAQRBrIgUkACAFIAAoAhQgASACIAAoAhgoAgwRAQA6AAwgBSAANgIIIAUgAkU6AA0gBUEANgIEIAVBBGogAyAEEC0hACAFLQAMIQECfyABQQBHIAAoAgAiAkUNABpBASABDQAaIAUoAgghAQJAIAJBAUcNACAFLQANRQ0AIAEtABxBBHENAEEBIAEoAhRB/OfAAEEBIAEoAhgoAgwRAQANARoLIAEoAhRB4+TAAEEBIAEoAhgoAgwRAQALIAVBEGokAAvNAQEDfyMAQSBrIgMkAAJAIAEgASACaiIBSw0AQQEhAiAAKAIAIgVBAXQiBCABIAEgBEkbIgFBCCABQQhLGyIBQX9zQR92IQQCQCAFRQRAQQAhAgwBCyADIAU2AhwgAyAAKAIENgIUCyADIAI2AhggA0EIaiAEIAEgA0EUahBCIAMoAggEQCADKAIMIgBFDQEgACADKAIQQdT/wAAoAgAiAEHXACAAGxECAAALIAMoAgwhAiAAIAE2AgAgACACNgIEIANBIGokAA8LEJcBAAvNAQEDfyMAQSBrIgMkAAJAIAEgASACaiIBSw0AQQEhAiAAKAIAIgVBAXQiBCABIAEgBEkbIgFBCCABQQhLGyIBQX9zQR92IQQCQCAFRQRAQQAhAgwBCyADIAU2AhwgAyAAKAIENgIUCyADIAI2AhggA0EIaiAEIAEgA0EUahA/IAMoAggEQCADKAIMIgBFDQEgACADKAIQQdT/wAAoAgAiAEHXACAAGxECAAALIAMoAgwhAiAAIAE2AgAgACACNgIEIANBIGokAA8LEJcBAAvEAQEBfyMAQRBrIg8kACAAKAIUIAEgAiAAKAIYKAIMEQEAIQEgD0EAOgANIA8gAToADCAPIAA2AgggD0EIaiADIAQgBSAGECAgByAIIAkgChAgIAsgDCANIA4QICECIA8tAAwhAQJ/IAFBAEcgDy0ADUUNABpBASABDQAaIAIoAgAiAC0AHEEEcUUEQCAAKAIUQffnwABBAiAAKAIYKAIMEQEADAELIAAoAhRB9ufAAEEBIAAoAhgoAgwRAQALIA9BEGokAAvSAQEDfyMAQdAAayIAJAAgAEEzNgIMIABB3JHAADYCCCAAQQA2AiggAEKAgICAEDcCICAAQQM6AEwgAEEgNgI8IABBADYCSCAAQdyNwAA2AkQgAEEANgI0IABBADYCLCAAIABBIGo2AkAgAEEIaiIBKAIAIAEoAgQgAEEsahDzAQRAQfSNwABBNyAAQRBqQayOwABBiI/AABBWAAsgAEEQaiIBQQhqIABBKGooAgAiAjYCACAAIAApAiA3AxAgACgCFCACEAEgARC3ASAAQdAAaiQAC7QBAQN/IwBBEGsiAiQAIAJCgICAgMAANwIEIAJBADYCDEEAIAFBCGsiBCABIARJGyIBQQN2IAFBB3FBAEdqIgQEQEEIIQEDQCACKAIEIANGBEAgAkEEaiADEHcgAigCDCEDCyACKAIIIANBAnRqIAE2AgAgAiACKAIMQQFqIgM2AgwgAUEIaiEBIARBAWsiBA0ACwsgACACKQIENwIAIABBCGogAkEMaigCADYCACACQRBqJAALvQwBEn8jAEEQayIQJAAgACgCnAEiCCAAKAIYRwRAIABBADoAwQELIBBBCGohESAAKAKgASENIAAoAmghCyAAKAJsIQcjAEFAaiIGJABBACAAKAIUIgMgACgCHCIJayAHaiIBIANrIgIgASACSRshDiAAKAIQIQwgACgCGCEPAkAgA0UNACABRQ0AIAMgB2ogCUF/c2ohBCAMQQxqIQUgA0EEdEEQayEBA0AgCiAPakEAIAUtAAAiAhshCiAOIAJBAXNqIQ4gBEUNASAFQRBqIQUgBEEBayEEIAEiAkEQayEBIAINAAsLAkAgCCAPRg0AIAogC2ohCiAAQQA2AhQgBkEANgI4IAYgAzYCNCAGIABBDGoiBzYCMCAGIAwgA0EEdGo2AiwgBiAMNgIoIAYgCDYCPCAGQYCAgIB4NgIYIAZBDGohCyMAQdAAayIBJAAgAUEYaiAGQRhqIgQQFgJAAkACQCABKAIYQYCAgIB4RgRAIAtBADYCCCALQoCAgIDAADcCACAEEJ4BDAELQZn/wAAtAAAaQcAAQQQQyAEiAkUNASACIAEpAhg3AgAgAUEMaiIDQQhqIg9BATYCACACQQhqIAFBIGopAgA3AgAgASACNgIQIAFBBDYCDCABQShqIgwgBEEoEPcBGiMAQRBrIgIkACACIAwQFiACKAIAQYCAgIB4RwRAIAMoAggiBEEEdCEFA0AgAygCACAERgRAIAMgBEEBEHgLIAMgBEEBaiIENgIIIAMoAgQgBWoiEiACKQIANwIAIBJBCGogAkEIaikCADcCACACIAwQFiAFQRBqIQUgAigCAEGAgICAeEcNAAsLIAwQngEgAkEQaiQAIAtBCGogDygCADYCACALIAEpAgw3AgALIAFB0ABqJAAMAQtBBEHAAEHU/8AAKAIAIgBB1wAgABsRAgAACyAGKAIUQQR0IQQgBigCECEFAkADQCAERQ0BIARBEGshBCAFKAIIIAVBEGohBSAIRg0AC0GwnsAAQTdB6J7AABCMAQALIAZBIGoiASAGQRRqKAIANgIAIAYgBikCDDcDGCAHEHsgBygCACICBEAgACgCECACQQR0ENQBCyAHIAYpAxg3AgAgB0EIaiABKAIANgIAIAkgACgCFCIDSwRAIAAgCSADayAIEGggACgCFCEDC0EAIQQCQCAORQ0AIANBAWsiAkUNACAAKAIQQQxqIQVBACEBA0ACQCADIARHBEAgBEEBaiEEIA4gASAFLQAAQQFzaiIBSw0BDAMLIAMgA0HwncAAEF8ACyAFQRBqIQUgAiAESw0ACwsCQAJAIAggCksNACAEIAMgAyAESRshASAAKAIQIARBBHRqQQxqIQUDQCABIARGDQIgBS0AAEUNASAFQRBqIQUgBEEBaiEEIAogCGsiCiAITw0ACwsgCiAIQQFrIgEgASAKSxshCyAEIAkgA2tqIgFBAE4hAiABQQAgAhshByAJQQAgASACG2shCQwBCyABIANB4J3AABBfAAsCQAJAAkACQAJAQX8gCSANRyAJIA1LG0H/AXEOAgIAAQtBACADIAlrIgEgASADSxsiAiANIAlrIgEgASACSxsiBEEAIAcgCUkbIAdqIQcgASACTQ0BIAAgASAEayAIEGgMAQsgAEEMaiECIAkgDWsiBCAJIAdBf3NqIgEgASAESxsiBQRAAkAgAyAFayIBIAIoAggiA0sNACACIAE2AgggASADRg0AIAMgAWshAyACKAIEIAFBBHRqIQEDQCABKAIAIgIEQCABQQRqKAIAIAJBBHQQ1AELIAFBEGohASADQQFrIgMNAAsLIAAoAhQiAUUNAiAAKAIQIAFBBHRqQQRrQQA6AAALIAcgBGsgBWohBwsgAEEBOgAgIAAgDTYCHCAAIAg2AhggESAHNgIEIBEgCzYCACAGQUBrJAAMAQtB0J3AABDeAQALIAAgECkDCDcCaCAAQdwAaiEIAkAgACgCoAEiASAAKAJkIgJNBEAgACABNgJkDAELIAggASACa0EAEE8gACgCoAEhAQsgCEEAIAEQbSAAKAKcASIBIAAoAnRNBEAgACABQQFrNgJ0CyAAKAKgASIBIAAoAnhNBEAgACABQQFrNgJ4CyAQQRBqJAALugEBAX8jAEEQayILJAAgACgCFCABIAIgACgCGCgCDBEBACEBIAtBADoADSALIAE6AAwgCyAANgIIIAtBCGogAyAEIAUgBhAgIAcgCCAJIAoQICECIAstAAwhAQJ/IAFBAEcgCy0ADUUNABpBASABDQAaIAIoAgAiAC0AHEEEcUUEQCAAKAIUQffnwABBAiAAKAIYKAIMEQEADAELIAAoAhRB9ufAAEEBIAAoAhgoAgwRAQALIAtBEGokAAuwAQEDf0EBIQRBBCEGAkAgAUUNACACQQBIDQACfwJAAkACfyADKAIEBEAgAygCCCIBRQRAIAJFBEAMBAtBmf/AAC0AABogAkEBEMgBDAILIAMoAgAgAUEBIAIQvgEMAQsgAkUEQAwCC0GZ/8AALQAAGiACQQEQyAELIgRFDQELIAAgBDYCBEEADAELIABBATYCBEEBCyEEQQghBiACIQULIAAgBmogBTYCACAAIAQ2AgALwwEBAn8jAEFAaiICJAACQCABBEAgASgCACIDQX9GDQEgASADQQFqNgIAIAJBATYCFCACQayMwAA2AhAgAkIBNwIcIAJBATYCLCACIAFBBGo2AiggAiACQShqNgIYIAJBMGoiAyACQRBqEB0gASABKAIAQQFrNgIAIAJBCGogAxDKASACKAIIIQEgAiACKAIMNgIEIAIgATYCACACKAIEIQEgACACKAIANgIAIAAgATYCBCACQUBrJAAPCxDrAQALEOwBAAuaAQEBfyAAIgQCfwJAAn8CQAJAIAEEQCACQQBIDQEgAygCBARAIAMoAggiAARAIAMoAgAgACABIAIQvgEMBQsLIAJFDQJBmf/AAC0AABogAiABEMgBDAMLIARBADYCBAwDCyAEQQA2AgQMAgsgAQsiAARAIAQgAjYCCCAEIAA2AgRBAAwCCyAEIAI2AgggBCABNgIEC0EBCzYCAAubAQEBfwJAAkAgAQRAIAJBAEgNAQJ/IAMoAgQEQAJAIAMoAggiBEUEQAwBCyADKAIAIAQgASACEL4BDAILCyABIAJFDQAaQZn/wAAtAAAaIAIgARDIAQsiAwRAIAAgAjYCCCAAIAM2AgQgAEEANgIADwsgACACNgIIIAAgATYCBAwCCyAAQQA2AgQMAQsgAEEANgIECyAAQQE2AgAL8QIBA38jAEEwayIEJAAgACgCGCEFIARBLGogA0EIai8AADsBACAEQSA2AiAgBCADKQAANwIkIARBEGogBEEgaiAFEEkgBEEAOgAcIARBCGogABCLAQJAIAEgAk0EQCAEKAIMIgAgAkkNASAEKAIIIAFBBHRqIQAgBEEQaiEDIwBBEGsiBSQAAkAgAiABayIBRQRAIAMoAgAiAEUNASADKAIEIABBBHQQ1AEMAQsgACABQQFrIgJBBHRqIQEgAgRAIAMtAAwhAgNAIAUgAxBYIAAoAgAiBgRAIAAoAgQgBkEEdBDUAQsgACAFKQMANwIAIAAgAjoADCAAQQhqIAVBCGooAgA2AgAgASAAQRBqIgBHDQALCyABKAIAIgAEQCABKAIEIABBBHQQ1AELIAEgAykCADcCACABQQhqIANBCGopAgA3AgALIAVBEGokACAEQTBqJAAPCyABIAJBoJ7AABDcAQALIAIgAEGgnsAAENoBAAvIAQECfwJAAkAgACgCCCIFIAFPBEAgACgCBCABQQR0aiEAIAUgAWsiBCACSQRAQYyqwABBIUGwqsAAEIwBAAsgBCACayIEIAAgBEEEdGogAhASIAEgAmoiBCACSQ0BIAQgBUsNAiACBEAgAkEEdCECA0AgACADKQIANwIAIABBCGogA0EIaikCADcCACAAQRBqIQAgAkEQayICDQALCw8LIAEgBUG4p8AAENkBAAsgASAEQcinwAAQ3AEACyAEIAVByKfAABDaAQALjgEBA38jAEGAAWsiBCQAIAAoAgAhAANAIAIgBGpB/wBqIABBD3EiA0EwciADQdcAaiADQQpJGzoAACACQQFrIQIgAEEQSSAAQQR2IQBFDQALIAJBgAFqIgBBgQFPBEAgAEGAAUGc6MAAENkBAAsgAUGs6MAAQQIgAiAEakGAAWpBACACaxAUIARBgAFqJAALlgEBA38jAEGAAWsiBCQAIAAtAAAhAkEAIQADQCAAIARqQf8AaiACQQ9xIgNBMHIgA0E3aiADQQpJGzoAACAAQQFrIQAgAkH/AXEiA0EEdiECIANBEE8NAAsgAEGAAWoiAkGBAU8EQCACQYABQZzowAAQ2QEACyABQazowABBAiAAIARqQYABakEAIABrEBQgBEGAAWokAAuXAQEDfyMAQYABayIEJAAgAC0AACECQQAhAANAIAAgBGpB/wBqIAJBD3EiA0EwciADQdcAaiADQQpJGzoAACAAQQFrIQAgAkH/AXEiA0EEdiECIANBEE8NAAsgAEGAAWoiAkGBAU8EQCACQYABQZzowAAQ2QEACyABQazowABBAiAAIARqQYABakEAIABrEBQgBEGAAWokAAuNAQEDfyMAQYABayIEJAAgACgCACEAA0AgAiAEakH/AGogAEEPcSIDQTByIANBN2ogA0EKSRs6AAAgAkEBayECIABBEEkg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IQEgCCAFNgIEIAggATYCACACQSBqJAAMAQsgAkEBNgIMIAJBmJfAADYCCCACQgA3AhQgAkH0lsAANgIQIAJBCGpB7JfAABCSAQALIAMoAggiAUGBgICAeEYNACABRQ0BIAEgAygCDEHU/8AAKAIAIgBB1wAgABsRAgAACyADQRBqJAAMAQsQlwEACyAGQQhqIAcpAgQ3AwAgBigCCCEBIAYgBigCDDYCBCAGIAE2AgAgBigCBCEBIAAgBigCADYCACAAIAE2AgQgBkEgaiQAC3EBAX8jAEEQayICJAAgAiAAQSBqNgIMIAFBkYTAAEEGQZeEwABBBSAAQQxqQZyEwABBrITAAEEEIABBGGpBsITAAEEEIABBHGpBoILAAEG0hMAAQRAgAEHEhMAAQdSEwABBCyACQQxqEDIgAkEQaiQAC3EBAX8jAEEQayICJAAgAiAAQRNqNgIMIAFBrIrAAEEIQbSKwABBCiAAQaCCwABBvorAAEEKIABBBGpBoIDAAEEDIABBCGpBuIbAAEHvh8AAQQsgAEESakHohsAAQfqHwABBDiACQQxqEDIgAkEQaiQAC28BAX8jAEEwayICJAAgAiABNgIEIAIgADYCACACQSxqQdYANgIAIAJBAzYCDCACQYTkwAA2AgggAkICNwIUIAJB1gA2AiQgAiACQSBqNgIQIAIgAkEEajYCKCACIAI2AiAgAkEIakHkmsAAEJIBAAtsAQF/IwBBMGsiAyQAIAMgATYCBCADIAA2AgAgA0EsakHWADYCACADQQI2AgwgA0GM5sAANgIIIANCAjcCFCADQdYANgIkIAMgA0EgajYCECADIAM2AiggAyADQQRqNgIgIANBCGogAhCSAQALZgECfyMAQRBrIgIkACAAKAIAIgNBAWohAAJ/IAMtAABFBEAgAiAANgIIIAFBtJLAAEEHIAJBCGpBvJLAABA3DAELIAIgADYCDCABQcySwABBAyACQQxqQdCSwAAQNwsgAkEQaiQAC2IBA38jAEEQayIDJAAgASgCCCEEIANBCGogASgCACACNQIAEEogAygCDCECIAMoAggiBUUEQCABQQRqIAQgAhDWASABIARBAWo2AggLIAAgBTYCACAAIAI2AgQgA0EQaiQAC2YAIwBBMGsiACQAQZj/wAAtAAAEQCAAQQI2AhAgAEHQ38AANgIMIABC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QRBxRQRAIANBIHFFBEAgADMBACABECMPCyMAQYABayIDJAAgAC8BACECQQAhAANAIAAgA2pB/wBqIAJBD3EiBEEwciAEQTdqIARBCkkbOgAAIABBAWshACACQf//A3EiBEEEdiECIARBEE8NAAsgAEGAAWoiAkGBAU8EQCACQYABQZzowAAQ2QEACyABQazowABBAiAAIANqQYABakEAIABrEBQgA0GAAWokAA8LIwBBgAFrIgMkACAALwEAIQJBACEAA0AgACADakH/AGogAkEPcSIEQTByIARB1wBqIARBCkkbOgAAIABBAWshACACQf//A3EiBEEEdiECIARBEE8NAAsgAEGAAWoiAkGBAU8EQCACQYABQZzowAAQ2QEACyABQazowABBAiAAIANqQYABakEAIABrEBQgA0GAAWokAAs3AQF/IAAoAgAhACABKAIcIgJBEHFFBEAgAkEgcUUEQCAAIAEQ3QEPCyAAIAEQRg8LIAAgARBHCzcBAX8gACgCACEAIAEoAhwiAkEQcUUEQCACQSBxRQRAIAAgARDbAQ8LIAAgARBIDwsgACABEEULsAIBAn8jAEEgayICJAAgAkEBOwEcIAIgATYCGCACIAA2AhQgAkHI5cAANgIQIAJByOTAADYCDCMAQRBrIgEkACACQQxqIgAoAggiAkUEQEGk4MAAEN4BAAsgASAAKAIMNgIMIAEgADYCCCABIAI2AgQjAEEQayIAJAAgAUEEaiIBKAIAIgIoAgwhAwJAAkACQAJAIAIoAgQOAgABAgsgAw0BQeDdwAAhAkEAIQMMAgsgAw0AIAIoAgAiAigCBCEDIAIoAgAhAgwBCyAAIAI2AgwgAEGAgICAeDYCACAAQejgwAAgASgCBCIAKAIIIAEoAgggAC0AECAALQAREDQACyAAIAM2AgQgACACNgIAIABB1ODAACABKAIEIgAoAgggASgCCCAALQAQIAAtABEQNAALMwEBfyMAQRBrIgIkACACIAAoAgA2AgwgAUHYisAAQQ0gAkEMakHoisAAEDcgAkEQaiQACzABAX8gASgCHCICQRBxRQRAIAJBIHFFBEAgACABENsBDwsgACABEEgPCyAAIAEQRQswAQF/IAEoAhwiAkEQcUUEQCACQSBxRQRAIAAgARDdAQ8LIAAgARBGDwsgACABEEcLMAACQAJAIANp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AgAgCkEwaiQADAILQZ6TwABBxgAgCkEvakHkk8AAQcSUwAAQVgALIwBBMGsiACQAIABBATYCECAAQZTlwAA2AgwgAEIBNwIYIABB7QA2AiggACAAQSRqNgIUIAAgAEEvajYCJCAAQQxqQZiWwAAQkgEACyATQRBqJAAgAAvGAQECfyMAQRBrIgAkACABKAIUQaDfwABBCyABKAIYKAIMEQEAIQMgAEEIaiICQQA6AAUgAiADOgAEIAIgATYCACACIgEtAAQhAwJAIAItAAVFBEAgA0EARyEBDAELQQEhAiADRQRAIAEoAgAiAi0AHEEEcUUEQCABIAIoAhRB9+fAAEECIAIoAhgoAgwRAQAiAToABAwCCyACKAIUQfbnwABBASACKAIYKAIMEQEAIQILIAEgAjoABCACIQELIABBEGokACABCzABAX8gAEEQahAuAkAgACgCACIBQYCAgIB4Rg0AIAFFDQAgACgCBCABQQR0ENQBCwsvAQJ/IAAgACgCqAEiAiAAKAKsAUEBaiIDIAEgAEGyAWoQISAAQdwAaiACIAMQbQsvAQJ/IAAgACgCqAEiAiAAKAKsAUEBaiIDIAEgAEGyAWoQUCAAQdwAaiACIAMQbQsrACABIAJJBEBBjKnAAEEjQfypwAAQjAEACyACIAAgAkEEdGogASACaxASCyUAIABFBEBBqJbAAEEyEOoBAAsgACACIAMgBCAFIAEoAhARBwALMAAgASgCFCAALQAAQQJ0IgBBjI3AAGooAgAgAEHUjMAAaigCACABKAIYKAIMEQEACzAAIAEoAhQgAC0AAEECdCIAQdCNwABqKAIAIABBxI3AAGooAgAgASgCGCgCDBEBAAuoAQEDfyMAQeABayIBJAAjAEHwAWsiAiQAAkACQCAABEAgACgCAA0BIABBADYCACACQQxqIgMgAEHkARD3ARogASADQQRqQeABEPcBGiAAQeQBENQBIAJB8AFqJAAMAgsQ6wEACxDsAQALIAFBxAFqELMBIAFBDGoiABB7IAAQrgEgAUEwaiIAEHsgABCuASABQdAAahCvASABQdwAahC3ASABQeABaiQACyMAIABFBEBBqJbAAEEyEOoBAAsgACACIAMgBCABKAIQEQUACyMAIABFBEBBqJbAAEEyEOoBAAsgACACIAMgBCABKAIQERcACyMAIABFBEBB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cGFydAAAAAQAAAAEAAAABAAAAA0AAABwYXJ0cwAAAAQAAAAEAAAABAAAAA4AAABHcm91bmRFc2NhcGVFc2NhcGVJbnRlcm1lZGlhdGVDc2lFbnRyeUNzaVBhcmFtQ3NpSW50ZXJtZWRpYXRlQ3NpSWdub3JlRGNzRW50cnlEY3NQYXJhbURjc0ludGVybWVkaWF0ZURjc1Bhc3N0aHJvdWdoRGNzSWdub3JlT3NjU3RyaW5nU29zUG1BcGNTdHJpbmdmZ2JnYm9sZAFmYWludGl0YWxpY3VuZGVybGluZXN0cmlrZXRocm91Z2hibGlua2ludmVyc2VCdWZmZXJsaW5lcw8AAAAMAAAABAAAABAAAABjb2xzcm93c3Njcm9sbGJhY2tfbGltaXQEAAAADAAAAAQAAAARAAAAdHJpbV9uZWVkZWQABAAAAAQAAAAEAAAAEgAAAFBhcmFtcwAABAAAAAQAAAAEAAAAEwAAAFBhcnNlcnN0YXRlAAgAAAABAAAAAQAAABQAAABwYXJhbXMAABUAAAAMAAAABAAAABYAAABpbnRlcm1lZGlhdGVzAAAABAAAAAQAAAAEAAAAFwAAAE5vcm1hbEJvbGRGYWludEFzY2lpRHJhd2luZwAYAAAAJAAAAAQAAAAZAAAACAAAAAEAAAABAAAAGgAAAAQAAAAIAAAABAAAABsAAAAEAAAADAAAAAQAAAAcAAAACAAAAAoAAAABAAAAHQAAAAgAAAACAAAAAQAAAB4AAAAfAAAADAAAAAQAAAAgAAAACAAAAAEAAAABAAAAIQAAAAQAAAAUAAAABAAAACIAAAAjAAAADAAAAAQAAAAkAAAAVGVybWluYWxidWZmZXJvdGhlcl9idWZmZXJhY3RpdmVfYnVmZmVyX3R5cGVjdXJzb3JjaGFyc2V0c2FjdGl2ZV9jaGFyc2V0dGFic2luc2VydF9tb2Rlb3JpZ2luX21vZGVhdXRvX3dyYXBfbW9kZW5ld19saW5lX21vZGVuZXh0X3ByaW50X3dyYXBzdG9wX21hcmdpbmJvdHRvbV9tYXJnaW5zYXZlZF9jdHhhbHRlcm5hdGVfc2F2ZWRfY3R4ZGlydHlfbGluZXNyZXNpemFibGVyZXNpemVkACwCEAAEAAAAMAIQAAQAAACgAxAABgAAAKYDEAAMAAAAsgMQABIAAAA0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VVVVVFVVVVVVVVVVBQAUABQEUFVVVVVVVVUVUVVVVVVVVVUAAAAAAABAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQUAAFRVVVVVVVVVVVVVVVVVFQAAVVVRVVVVVVUFEAAAAQFQVVVVVVVVVVVVVQFVVVVVVVVVVVVVVVVVUFUAAFVVVVVVVVVVVVUFAEHQwsAAC+MNQFVVVVVVVVVVVVVVVVVFVAEAVFEBAFVVBVVVVVVVVVVRVVVVVVVVVVVVVVVVVVVEAVRVUVUVVVUFVVVVVVVVRUFVVVVVVVVVVVVVVVVVVVRBFRRQUVVVVVVVVVVQUVVVARBUUVVVVVUFVVVVVVUFAFFVVVVVVVVVVVVVVVVVVQQBVFVRVQFVVQVVVVVVVVVVRVVVVVVVVVVVVVVVVVVVRVRVVVFVFVVVVVVVVVVVVVVUVFVVVVVVVVVVVVVVVVUEVAUEUFVBVVUFVVVVVVVVVVFVVVVVVVVVVVVVVVVVVRREBQRQVUFVVQVVVVVVVVVVUFVVVVVVVVVVVVVVVVUVRAFUVVFVFVVVBVVVVVVVVVVRVVVVVVVVVVVVVVVVVVVVVVVFFQVEVRVVVVVVVVVVVVVVVVVVVVVVVVVVVVEAQFVVFQBAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUQAAVFVVAEBVVVVVVVVVVVVVVVVVVVVVVVVQVVVVVVVVEVFVVVVVVVVVVVVVVVVVAQAAQAAEVQEAAAEAAAAAAAAAAFRVRVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUBBABBQVVVVVVVVVAFVFVVVQFUVVVFQVVRVVVVUVVVVVVVVVVVqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqAAAAAAAAAABVVVVVVVVVAVVVVVVVVVVVVVVVVQVUVVVVVVVVBVVVVVVVVVUFVVVVVVVVVQVVVVVVVVVVVVVVVVVVVVVVEABQVUUBAABVVVFVVVVVVVVVVVVVFQBVVVVVVVVVVVVVVVVVQVVVVVVVVVVVUVVVVVVVVVVVVVVVVVVAFVRVRVUBVVVVVVVVFRRVVVVVVVVVVVVVVVVVVUUAQEQBAFQVAAAUVVVVVVVVVVVVVVVVAAAAAAAAAEBVVVVVVVVVVVVVVVUAVVVVVVVVVVVVVVVVAABQBVVVVVVVVVVVVRUAAFVVVVBVVVVVVVVVBVAQUFVVVVVVVVVVVVVVVVVFUBFQVVVVVVVVVVVVVVVVVVUAAAVVVVVVVVVAAAAABABUUVVUUFVVVRUA139fX3//BUD3XdV1VVVVVVVVVVUAAAAAVVdVVf1XVVVVVVVVVVVVV1VVVVVVVVVVAAAAAAAAAABUVVVV1V1dVdV1VVV9VVVVVVVVVVVVVVXVV9V/////Vf//X1VVVV1V////VVVVVXVVVV9VVVVV9XVXVVVV1VVVVVVVVffX39ddXXX91///d1X/VV9dVV9XdVVVVX//9fVfVVVV9f9fVVVdXVVVXVVVVVVV1VVVVVV1VaVVVVVpVVVVVVVVVVVVVVVVVVVVqVaWVVVVVVVVVVVVVVX/////////////////////////////////////////////3///////////Vf///////////1VVVf/////1X1VV3/9fVfX1VV9f9df1X1VVVfVfVdVVVVVpVX1d9VVaVXdVVVVVVVVVVXdVqqqqVVVV399/31VVVZVVVVVVlVVV9VlVpVVVVVXpVfr/7//+///fVe//r/vv+1VZpVVVVVVVVVVWVVVVVV1VVVVmlZpVVVVVVVVV9f//VVVVVVWpVVVVVVVVVlVVlVVVVVVVVZVWVVVVVVVVVVVVVVVVVvlfVVVVVVVVVVVVVVVVVVVVVVVVVVUVUFVVVVVVVVVVVVVVVVVVVVVVVRVVVVVVVVVVVQAAAAAAAAAAqqqqqqqqmqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpVVVWqqqqqqlpVVVVVVVWqqqqqqqqqqqqqqqqqqgoAqqqqaqmqqqqqqqqqqqqqqqqqqqqqqqqqqmqBqqqqqqqqqqqqVamqqqqqqqqqqqqqqaqqqqqqqqqqqqqqqqiqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqVVWVqqqqqqqqqqqqqqpqqqqqqqqqqqqqqv//qqqqqqqqqqqqqqqqqqqqVqqqqqqqqqqqqqqqqqpqVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVRVAAABQVVVVVVVVVQVVVVVVVVVVVVVVVVVVVVVVVVVVVVBVVVVFRRVVVVVVVVVBVVRVVVVVVVBVVVVVVVUAAAAAUFVFFVVVVVVVVVVVVQUAUFVVVVVVFQAAUFVVVaqqqqqqqqpWQFVVVVVVVVVVVVVVFQVQUFVVVVVVVVVVVVFVVVVVVVVVVVVVVVVVVVVVAUBBQVVVFVVVVFVVVVVVVVVVVVVVVFVVVVVVVVVVVVVVVQQUVAVRVVVVVVVVVVVVVVBVRVVVVVVVVVVVVVVVUVRRVVVVVaqqqqqqqqqqqlVVVQAAAAAAQBUAQb/QwAALoQhVVVVVVVVVVUVVVVVVVVVVVQAAAACqqlpVAAAAAKqqqqqqqqqqaqqqqqpqqlVVVVVVqqqqqqqqqqpWVVVVVVVVVVVVVVVVVVUFVFVVVVVVVVVVVVVVVVVVVapqVVUAAFRdVVVVVVVVVVVVVVVVVVVVUVVVVVVVVVVVVFVVVVVVVVVVVVVVVVVVVVVVVVVVBUBVAUFVAFVVVVVVVVVVVVVAFVVVVVVVVVVVVUFVVVVVVVVVVVVVVVVVVVUAVVVVVVVVVVVVVVVVVVVVVRVUVVVVVVVVVVVVVVVVVVVVVVVVVQFVBQAAVFVVVVVVVVVVVVVVBVBVVVVVVVVVVVVVVVVVVVFVVVVVVVVVVVVVVVVVAAAAQFVVVVVVVVVVVVUUVFUVUFVVVVVVVVVVVVVVFUBBVUVVVVVVVVVVVVVVVVVVVVVAVVVVVVVVVVUVAAEAVFVVVVVVVVVVVVVVVVVVFVVVVVBVVVVVVVVVVVVVVVUFAEBVVQEUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUVUARVRVVVVVVVVVUVFQBAVVVVVVVUVVVVVRVVVVUFAFQAVFVVVVVVVVVVVVVVVVVVVVUAAAVEVVVVVVVFVVVVVVVVVVVVVVVVVVVVVVVVVVUUAEQRBFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVFQVQVRBUVVVVVVVVUFVVVVVVVVVVVVVVVVVVVVVVVVVVFQBAEVRVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVFVEAEFVVVVVVVVVVVQEFEABVVVVVVVVVVVVVVVVVVVVVFQAAQVVVVVVVVVVVVVVVVVVUVRVEFVVVVVVVVVVVVVVVVVVVVVVVVVVVAAVVVFVVVVVVVVUBAEBVVVVVVVVVVVUVABRAVRVVVQFAAVVVVVVVVVVVVVVVBQAAQFBVVVVVVVVVVVVVVVVVVVVVVVVVVVUAQAAQVVVVVQUAAAAAAAUABEFVVVVVVVVVVVVVVVVVVQFARRAAEFVVVVVVVVVVVVVVVVVVVVVVVVARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVRVUVVVQVVVVVVVVVVVVVVVVBUBVRFVVVVVVVVVVVVVVVVVVVVQVAAAAUFVVVVVVVVVVVVVVVVVVVVVVVVVVVVUAVFVVVVVVVVVVVVVVVVVVAEBVVVVVVRVVVVVVVVVVVVVVVVVVVVUVQFVVVVVVVVVVVVVVVVVVVVVVVVWqVFVVWlVVVaqqqqqqqqqqqqqqqqqqVVWqqqqqqlpVVVVVVVVVVVVVqqpWVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVaqpqmmqqqqqqqqqqmpVVVVlVVVVVVVVVWpZVVVVqlVVqqqqqqqqqqqqqqqqqqqqqqqqqlVVVVVVVVVVQQBVVVVVVVVVAEHr2MAAC0VQAAAAAABAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVURUAUAAAAAQAEAVVVVVVVVVQVQVVVVVQVUVVVVVVVVVVVVVVVVVVUAQb3ZwAALAkAVAEHL2cAAC8slVFVRVVVVVFVVVVUVAAEAAABVVVVVAEAAAAAAFAAQBEBVVVVVVVVVVVVVVVVVVVVVRVVVVVVVVVVVVVVVVVVVVQBVVVVVVVVVVQBAVVVVVVVVVVVVVVUAQFVVVVVVVVVVVVVVVVVVVlVVVVVVVVVVVVVVVVVVVVVVlVVVVVVVVVVVVVVVVf//f1X/////////X///////////////////X1X/////////76uq6v////9XVVVVVWpVVVWqqqqqqqqqqqqqqlWqqlZVWlVVVapaVVVVVVVVqqqqqqqqqqpWVVWpqpqqqqqqqqqqqqqqqqqqqqqqqqaqqqqqqlVVVaqqqqqqqqqqqqpqlapVVVWqqqqqVlaqqqqqqqqqqqqqqqqqqqqqqmqmqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqlqqqqqqqqqqqqqqqqqqqqlpVVZVqqqqqqqqqVVVVVWVVVVVVVVVpVVVVVlVVVVVVVVVVVVVVVVVVVVVVVVVVlaqqqqqqVVVVVVVVVVVVVVVVqlpVVmqpVapVVZVWVaqqVlVVVVVVVVVVqqqqVVZVVVVVVVWqqqqqqqqqqqqqqmqqqpqqqqqqqqqqqqqqqqqqqlVVVVVVVVVVVVVVVaqqqlaqqlZVqqqqqqqqqqqqqqqaqlpVpaqqqlWqqlZVqqpWVf///////////////////19YAAAADAAAAAQAAABZAAAAWgAAAFsAAAAvcnVzdC9kZXBzL2RsbWFsbG9jLTAuMi42L3NyYy9kbG1hbGxvYy5yc2Fzc2VydGlvbiBmYWlsZWQ6IHBzaXplID49IHNpemUgKyBtaW5fb3ZlcmhlYWQA+C4QACkAAACoBAAACQAAAGFzc2VydGlvbiBmYWlsZWQ6IHBzaXplIDw9IHNpemUgKyBtYXhfb3ZlcmhlYWQAAPguEAApAAAArgQAAA0AAABBY2Nlc3NFcnJvcm1lbW9yeSBhbGxvY2F0aW9uIG9mICBieXRlcyBmYWlsZWQAAACrLxAAFQAAAMAvEAANAAAAbGlicmFyeS9zdGQvc3JjL2FsbG9jLnJz4C8QABgAAABiAQAACQAAAGxpYnJhcnkvc3RkL3NyYy9wYW5pY2tpbmcucnMIMBAAHAAAAIQCAAAeAAAAWAAAAAwAAAAEAAAAXAAAAF0AAAAIAAAABAAAAF4AAABdAAAACAAAAAQAAABfAAAAYAAAAGEAAAAQAAAABAAAAGIAAABjAAAAZAAAAAAAAAABAAAAZQAAAEhhc2ggdGFibGUgY2FwYWNpdHkgb3ZlcmZsb3eMMBAAHAAAAC9ydXN0L2RlcHMvaGFzaGJyb3duLTAuMTQuMy9zcmMvcmF3L21vZC5ycwAAsDAQACoAAABWAAAAKAAAAEVycm9yAAAAZgAAAAwAAAAEAAAAZwAAAGgAAABpAAAAY2FwYWNpdHkgb3ZlcmZsb3cAAAAMMRAAEQAAAGxpYnJhcnkvYWxsb2Mvc3JjL3Jhd192ZWMucnMoMRAAHAAAABkAAAAFAAAAYSBmb3JtYXR0aW5nIHRyYWl0IGltcGxlbWVudGF0aW9uIHJldHVybmVkIGFuIGVycm9yAGoAAAAAAAAAAQAAAGsAAABsaWJyYXJ5L2FsbG9jL3NyYy9mbXQucnOYMRAAGAAAAHkCAAAgAAAAKSBzaG91bGQgYmUgPCBsZW4gKGlzIClpbnNlcnRpb24gaW5kZXggKGlzICkgc2hvdWxkIGJlIDw9IGxlbiAoaXMgAADXMRAAFAAAAOsxEAAXAAAA1jEQAAEAAAByZW1vdmFsIGluZGV4IChpcyAAABwyEAASAAAAwDEQABYAAADWMRAAAQAAAGxpYnJhcnkvY29yZS9zcmMvZm10L21vZC5ycykwMTIzNDU2Nzg5YWJjZGVmQm9ycm93TXV0RXJyb3JhbHJlYWR5IGJvcnJvd2VkOiCCMhAAEgAAAFtjYWxsZWQgYE9wdGlvbjo6dW53cmFwKClgIG9uIGEgYE5vbmVgIHZhbHVlcQAAAAAAAAABAAAAcgAAAGluZGV4IG91dCBvZiBib3VuZHM6IHRoZSBsZW4gaXMgIGJ1dCB0aGUgaW5kZXggaXMgAADYMhAAIAAAAPgyEAASAAAAcwAAAAQAAAAEAAAAdAAAAD09IT1tYXRjaGVzYXNzZXJ0aW9uIGBsZWZ0ICByaWdodGAgZmFpbGVkCiAgbGVmdDogCiByaWdodDogADczEAAQAAAARzMQABcAAABeMxAACQAAACByaWdodGAgZmFpbGVkOiAKICBsZWZ0OiAAAAA3MxAAEAAAAIAzEAAQAAAAkDMQAAkAAABeMxAACQAAADogAABIMhAAAAAAALwzEAACAAAAcwAAAAwAAAAEAAAAdQAAAHYAAAB3AAAAICAgICB7ICwgIHsKLAp9IH0oKAosCl1saWJyYXJ5L2NvcmUvc3JjL2ZtdC9udW0ucnMAAP8zEAAbAAAAaQAAABcAAAAweDAwMDEwMjAzMDQwNTA2MDcwODA5MTAxMTEyMTMxNDE1MTYxNzE4MTkyMDIxMjIyMzI0MjUyNjI3MjgyOTMwMzEzMjMzMzQzNTM2MzczODM5NDA0MTQyNDM0NDQ1NDY0NzQ4NDk1MDUxNTI1MzU0NTU1NjU3NTg1OTYwNjE2MjYzNjQ2NTY2Njc2ODY5NzA3MTcyNzM3NDc1NzY3Nzc4Nzk4MDgxODI4Mzg0ODU4Njg3ODg4OTkwOTE5MjkzOTQ5NTk2OTc5ODk5AABIMhAAGwAAAAIIAAAJAAAAcwAAAAgAAAAEAAAAbgAAAGZhbHNldHJ1ZXJhbmdlIHN0YXJ0IGluZGV4ICBvdXQgb2YgcmFuZ2UgZm9yIHNsaWNlIG9mIGxlbmd0aCAAAAAhNRAAEgAAADM1EAAiAAAAcmFuZ2UgZW5kIGluZGV4IGg1EAAQAAAAMzUQACIAAABzbGljZSBpbmRleCBzdGFydHMgYXQgIGJ1dCBlbmRzIGF0IACINRAAFgAAAJ41EAANAAAAYXR0ZW1wdGVkIHRvIGluZGV4IHNsaWNlIHVwIHRvIG1heGltdW0g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AwEFKwM8CCoYASA3AQEBBAgEAQMHCgIdAToBAQECBAgBCQEKAhoBAgI5AQQCBAICAwMBHgIDAQsCOQEEBQECBAEUAhYGAQE6AQECAQQIAQcDCgIeATsBAQEMAQkBKAEDATcBAQMFAwEEBwILAh0BOgECAQIBAwEFAgcCCwIcAjkCAQECBAgBCQEKAh0BSAEEAQIDAQEIAVEBAgcMCGIBAgkLB0kCGwEBAQEBNw4BBQECBQsBJAkBZgQBBgECAgIZAgQDEAQNAQICBgEPAQADAAMdAh4CHgJAAgEHCAECCwkBLQMBAXUCIgF2AwQCCQEGA9sCAgE6AQEHAQEBAQIIBgoCATAfMQQwBwEBBQEoCQwCIAQCAgEDOAEBAgMBAQM6CAICmAMBDQEHBAEGAQMCxkAAAcMhAAONAWAgAAZpAgAEAQogAlACAAEDAQQBGQIFAZcCGhINASYIGQsuAzABAgQCAicBQwYCAgICDAEIAS8BMwEBAwICBQIBASoCCAHuAQIBBAEAAQAQEBAAAgAB4gGVBQADAQIFBCgDBAGlAgAEAAJQA0YLMQR7ATYPKQECAgoDMQQCAgcBPQMkBQEIPgEMAjQJCgQCAV8DAgEBAgYBAgGdAQMIFQI5AgEBAQEWAQ4HAwXDCAIDAQEXAVEBAgYBAQIBAQIBAusBAgQGAgECGwJVCAIBAQJqAQEBAgYBAWUDAgQBBQAJAQL1AQoCAQEEAZAEAgIEASAKKAYCBAgBCQYCAy4NAQIABwEGAQFSFgIHAQIBAnoGAwEBAgEHAQFIAgMBAQEAAgsCNAUFAQEBAAEGDwAFOwcAAT8EUQEAAgAuAhcAAQEDBAUICAIHHgSUAwA3BDIIAQ4BFgUBDwAHARECBwECAQVkAaAHAAE9BAAEAAdtBwBggPAAewlwcm9kdWNlcnMCCGxhbmd1YWdlAQRSdXN0AAxwcm9jZXNzZWQtYnkDBXJ1c3RjHTEuNzguMCAoOWIwMDk1NmU1IDIwMjQtMDQtMjkpBndhbHJ1cwYwLjIwLjMMd2FzbS1iaW5kZ2VuEjAuMi45MiAoMmE0YTQ5MzYyKQAsD3RhcmdldF9mZWF0dXJlcwIrD211dGFibGUtZ2xvYmFscysIc2lnbi1leHQ=");

          var loadVt = async () => {
                  await __wbg_init(wasm_code);
                  return exports$1;
              };

  function parseNpt(time) {
    if (typeof time === "number") {
      return time;
    } else if (typeof time === "string") {
      return time.split(":").reverse().map(parseFloat).reduce((sum, n, i) => sum + n * Math.pow(60, i));
    } else {
      return undefined;
    }
  }
  function debounce(f, delay) {
    let timeout;
    return function () {
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      clearTimeout(timeout);
      timeout = setTimeout(() => f.apply(this, args), delay);
    };
  }
  function throttle(f, interval) {
    let enableCall = true;
    return function () {
      if (!enableCall) return;
      enableCall = false;
      for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        args[_key2] = arguments[_key2];
      }
      f.apply(this, args);
      setTimeout(() => enableCall = true, interval);
    };
  }

  class Clock {
    constructor() {
      let speed = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 1.0;
      this.speed = speed;
      this.startTime = performance.now();
    }
    getTime() {
      return this.speed * (performance.now() - this.startTime) / 1000.0;
    }
    setTime(time) {
      this.startTime = performance.now() - time / this.speed * 1000.0;
    }
  }
  class NullClock {
    constructor() {}
    getTime(_speed) {}
    setTime(_time) {}
  }

  const vt = loadVt(); // trigger async loading of wasm

  class State {
    constructor(core) {
      this.core = core;
      this.driver = core.driver;
    }
    onEnter(data) {}
    init() {}
    play() {}
    pause() {}
    togglePlay() {}
    seek(where) {
      return false;
    }
    step() {}
    stop() {
      this.driver.stop();
    }
  }
  class UninitializedState extends State {
    async init() {
      try {
        await this.core.initializeDriver();
        return this.core.setState("idle");
      } catch (e) {
        this.core.setState("errored");
        throw e;
      }
    }
    async play() {
      this.core.dispatchEvent("play");
      const idleState = await this.init();
      await idleState.doPlay();
    }
    async togglePlay() {
      await this.play();
    }
    async seek(where) {
      const idleState = await this.init();
      return await idleState.seek(where);
    }
    async step() {
      const idleState = await this.init();
      await idleState.step();
    }
    stop() {}
  }
  class Idle extends State {
    onEnter(_ref) {
      let {
        reason,
        message
      } = _ref;
      this.core.dispatchEvent("idle", {
        message
      });
      if (reason === "paused") {
        this.core.dispatchEvent("pause");
      }
    }
    async play() {
      this.core.dispatchEvent("play");
      await this.doPlay();
    }
    async doPlay() {
      const stop = await this.driver.play();
      if (stop === true) {
        this.core.setState("playing");
      } else if (typeof stop === "function") {
        this.core.setState("playing");
        this.driver.stop = stop;
      }
    }
    async togglePlay() {
      await this.play();
    }
    seek(where) {
      return this.driver.seek(where);
    }
    step() {
      this.driver.step();
    }
  }
  class PlayingState extends State {
    onEnter() {
      this.core.dispatchEvent("playing");
    }
    pause() {
      if (this.driver.pause() === true) {
        this.core.setState("idle", {
          reason: "paused"
        });
      }
    }
    togglePlay() {
      this.pause();
    }
    seek(where) {
      return this.driver.seek(where);
    }
  }
  class LoadingState extends State {
    onEnter() {
      this.core.dispatchEvent("loading");
    }
  }
  class OfflineState extends State {
    onEnter(_ref2) {
      let {
        message
      } = _ref2;
      this.core.dispatchEvent("offline", {
        message
      });
    }
  }
  class EndedState extends State {
    onEnter(_ref3) {
      let {
        message
      } = _ref3;
      this.core.dispatchEvent("ended", {
        message
      });
    }
    async play() {
      this.core.dispatchEvent("play");
      if (await this.driver.restart()) {
        this.core.setState('playing');
      }
    }
    async togglePlay() {
      await this.play();
    }
    seek(where) {
      if (this.driver.seek(where) === true) {
        this.core.setState('idle');
        return true;
      }
      return false;
    }
  }
  class ErroredState extends State {
    onEnter() {
      this.core.dispatchEvent("errored");
    }
  }
  class Core {
    // public

    constructor(driverFn, opts) {
      this.logger = opts.logger;
      this.state = new UninitializedState(this);
      this.stateName = "uninitialized";
      this.driver = null;
      this.driverFn = driverFn;
      this.changedLines = new Set();
      this.cursor = undefined;
      this.duration = undefined;
      this.cols = opts.cols;
      this.rows = opts.rows;
      this.speed = opts.speed ?? 1.0;
      this.loop = opts.loop;
      this.idleTimeLimit = opts.idleTimeLimit;
      this.preload = opts.preload;
      this.startAt = parseNpt(opts.startAt);
      this.poster = this.parsePoster(opts.poster);
      this.markers = this.normalizeMarkers(opts.markers);
      this.pauseOnMarkers = opts.pauseOnMarkers;
      this.commandQueue = Promise.resolve();
      this.eventHandlers = new Map([["ended", []], ["errored", []], ["idle", []], ["init", []], ["input", []], ["loading", []], ["marker", []], ["offline", []], ["pause", []], ["play", []], ["playing", []], ["reset", []], ["resize", []], ["seeked", []], ["terminalUpdate", []]]);
    }
    addEventListener(eventName, handler) {
      this.eventHandlers.get(eventName).push(handler);
    }
    dispatchEvent(eventName) {
      let data = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
      for (const h of this.eventHandlers.get(eventName)) {
        h(data);
      }
    }
    async init() {
      this.wasm = await vt;
      const feed = this.feed.bind(this);
      const onInput = data => {
        this.dispatchEvent("input", {
          data
        });
      };
      const onMarker = _ref4 => {
        let {
          index,
          time,
          label
        } = _ref4;
        this.dispatchEvent("marker", {
          index,
          time,
          label
        });
      };
      const now = this.now.bind(this);
      const setTimeout = (f, t) => window.setTimeout(f, t / this.speed);
      const setInterval = (f, t) => window.setInterval(f, t / this.speed);
      const reset = this.resetVt.bind(this);
      const setState = this.setState.bind(this);
      const posterTime = this.poster.type === "npt" ? this.poster.value : undefined;
      this.driver = this.driverFn({
        feed,
        onInput,
        onMarker,
        reset,
        now,
        setTimeout,
        setInterval,
        setState,
        logger: this.logger
      }, {
        cols: this.cols,
        rows: this.rows,
        idleTimeLimit: this.idleTimeLimit,
        startAt: this.startAt,
        loop: this.loop,
        posterTime: posterTime,
        markers: this.markers,
        pauseOnMarkers: this.pauseOnMarkers
      });
      if (typeof this.driver === "function") {
        this.driver = {
          play: this.driver
        };
      }
      if (this.preload || posterTime !== undefined) {
        this.withState(state => state.init());
      }
      const poster = this.poster.type === "text" ? this.renderPoster(this.poster.value) : undefined;
      const config = {
        isPausable: !!this.driver.pause,
        isSeekable: !!this.driver.seek,
        poster
      };
      if (this.driver.init === undefined) {
        this.driver.init = () => {
          return {};
        };
      }
      if (this.driver.pause === undefined) {
        this.driver.pause = () => {};
      }
      if (this.driver.seek === undefined) {
        this.driver.seek = where => false;
      }
      if (this.driver.step === undefined) {
        this.driver.step = () => {};
      }
      if (this.driver.stop === undefined) {
        this.driver.stop = () => {};
      }
      if (this.driver.restart === undefined) {
        this.driver.restart = () => {};
      }
      if (this.driver.getCurrentTime === undefined) {
        const play = this.driver.play;
        let clock = new NullClock();
        this.driver.play = () => {
          clock = new Clock(this.speed);
          return play();
        };
        this.driver.getCurrentTime = () => clock.getTime();
      }
      return config;
    }
    play() {
      return this.withState(state => state.play());
    }
    pause() {
      return this.withState(state => state.pause());
    }
    togglePlay() {
      return this.withState(state => state.togglePlay());
    }
    seek(where) {
      return this.withState(async state => {
        if (await state.seek(where)) {
          this.dispatchEvent("seeked");
        }
      });
    }
    step() {
      return this.withState(state => state.step());
    }
    stop() {
      return this.withState(state => state.stop());
    }
    withState(f) {
      return this.enqueueCommand(() => f(this.state));
    }
    enqueueCommand(f) {
      this.commandQueue = this.commandQueue.then(f);
      return this.commandQueue;
    }
    getChangedLines() {
      if (this.changedLines.size > 0) {
        const lines = new Map();
        const rows = this.vt.rows;
        for (const i of this.changedLines) {
          if (i < rows) {
            lines.set(i, {
              id: i,
              segments: this.vt.get_line(i)
            });
          }
        }
        this.changedLines.clear();
        return lines;
      }
    }
    getCursor() {
      if (this.cursor === undefined && this.vt) {
        this.cursor = this.vt.get_cursor() ?? false;
      }
      return this.cursor;
    }
    getCurrentTime() {
      return this.driver.getCurrentTime();
    }
    getRemainingTime() {
      if (typeof this.duration === "number") {
        return this.duration - Math.min(this.getCurrentTime(), this.duration);
      }
    }
    getProgress() {
      if (typeof this.duration === "number") {
        return Math.min(this.getCurrentTime(), this.duration) / this.duration;
      }
    }
    getDuration() {
      return this.duration;
    }

    // private

    setState(newState) {
      let data = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
      if (this.stateName === newState) return this.state;
      this.stateName = newState;
      if (newState === "playing") {
        this.state = new PlayingState(this);
      } else if (newState === "idle") {
        this.state = new Idle(this);
      } else if (newState === "loading") {
        this.state = new LoadingState(this);
      } else if (newState === "ended") {
        this.state = new EndedState(this);
      } else if (newState === "offline") {
        this.state = new OfflineState(this);
      } else if (newState === "errored") {
        this.state = new ErroredState(this);
      } else {
        throw `invalid state: ${newState}`;
      }
      this.state.onEnter(data);
      return this.state;
    }
    feed(data) {
      this.doFeed(data);
      this.dispatchEvent("terminalUpdate");
    }
    doFeed(data) {
      const [affectedLines, resized] = this.vt.feed(data);
      affectedLines.forEach(i => this.changedLines.add(i));
      this.cursor = undefined;
      if (resized) {
        const [cols, rows] = this.vt.get_size();
        this.vt.cols = cols;
        this.vt.rows = rows;
        this.logger.debug(`core: vt resize (${cols}x${rows})`);
        this.dispatchEvent("resize", {
          cols,
          rows
        });
      }
    }
    now() {
      return performance.now() * this.speed;
    }
    async initializeDriver() {
      const meta = await this.driver.init();
      this.cols = this.cols ?? meta.cols ?? 80;
      this.rows = this.rows ?? meta.rows ?? 24;
      this.duration = this.duration ?? meta.duration;
      this.markers = this.normalizeMarkers(meta.markers) ?? this.markers ?? [];
      if (this.cols === 0) {
        this.cols = 80;
      }
      if (this.rows === 0) {
        this.rows = 24;
      }
      this.initializeVt(this.cols, this.rows);
      const poster = meta.poster !== undefined ? this.renderPoster(meta.poster) : undefined;
      this.dispatchEvent("init", {
        cols: this.cols,
        rows: this.rows,
        duration: this.duration,
        markers: this.markers,
        theme: meta.theme,
        poster
      });
    }
    resetVt(cols, rows) {
      let init = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : undefined;
      let theme = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : undefined;
      this.cols = cols;
      this.rows = rows;
      this.cursor = undefined;
      this.initializeVt(cols, rows);
      if (init !== undefined && init !== "") {
        this.doFeed(init);
      }
      this.dispatchEvent("reset", {
        cols,
        rows,
        theme
      });
    }
    initializeVt(cols, rows) {
      this.logger.debug(`core: vt init (${cols}x${rows})`);
      this.vt = this.wasm.create(cols, rows, true, 100);
      this.vt.cols = cols;
      this.vt.rows = rows;
      this.changedLines.clear();
      for (let i = 0; i < rows; i++) {
        this.changedLines.add(i);
      }
    }
    parsePoster(poster) {
      if (typeof poster !== "string") return {};
      if (poster.substring(0, 16) == "data:text/plain,") {
        return {
          type: "text",
          value: [poster.substring(16)]
        };
      } else if (poster.substring(0, 4) == "npt:") {
        return {
          type: "npt",
          value: parseNpt(poster.substring(4))
        };
      }
      return {};
    }
    renderPoster(poster) {
      const cols = this.cols ?? 80;
      const rows = this.rows ?? 24;
      this.logger.debug(`core: poster init (${cols}x${rows})`);
      const vt = this.wasm.create(cols, rows, false, 0);
      poster.forEach(text => vt.feed(text));
      const cursor = vt.get_cursor() ?? false;
      const lines = [];
      for (let i = 0; i < rows; i++) {
        lines.push({
          id: i,
          segments: vt.get_line(i)
        });
      }
      return {
        cursor,
        lines
      };
    }
    normalizeMarkers(markers) {
      if (Array.isArray(markers)) {
        return markers.map(m => typeof m === "number" ? [m, ""] : m);
      }
    }
  }

  const $RAW = Symbol("store-raw"),
    $NODE = Symbol("store-node"),
    $NAME = Symbol("store-name");
  function wrap$1(value, name) {
    let p = value[$PROXY];
    if (!p) {
      Object.defineProperty(value, $PROXY, {
        value: p = new Proxy(value, proxyTraps$1)
      });
      if (!Array.isArray(value)) {
        const keys = Object.keys(value),
          desc = Object.getOwnPropertyDescriptors(value);
        for (let i = 0, l = keys.length; i < l; i++) {
          const prop = keys[i];
          if (desc[prop].get) {
            Object.defineProperty(value, prop, {
              enumerable: desc[prop].enumerable,
              get: desc[prop].get.bind(p)
            });
          }
        }
      }
    }
    return p;
  }
  function isWrappable(obj) {
    let proto;
    return obj != null && typeof obj === "object" && (obj[$PROXY] || !(proto = Object.getPrototypeOf(obj)) || proto === Object.prototype || Array.isArray(obj));
  }
  function unwrap(item, set = new Set()) {
    let result, unwrapped, v, prop;
    if (result = item != null && item[$RAW]) return result;
    if (!isWrappable(item) || set.has(item)) return item;
    if (Array.isArray(item)) {
      if (Object.isFrozen(item)) item = item.slice(0);else set.add(item);
      for (let i = 0, l = item.length; i < l; i++) {
        v = item[i];
        if ((unwrapped = unwrap(v, set)) !== v) item[i] = unwrapped;
      }
    } else {
      if (Object.isFrozen(item)) item = Object.assign({}, item);else set.add(item);
      const keys = Object.keys(item),
        desc = Object.getOwnPropertyDescriptors(item);
      for (let i = 0, l = keys.length; i < l; i++) {
        prop = keys[i];
        if (desc[prop].get) continue;
        v = item[prop];
        if ((unwrapped = unwrap(v, set)) !== v) item[prop] = unwrapped;
      }
    }
    return item;
  }
  function getDataNodes(target) {
    let nodes = target[$NODE];
    if (!nodes) Object.defineProperty(target, $NODE, {
      value: nodes = {}
    });
    return nodes;
  }
  function getDataNode(nodes, property, value) {
    return nodes[property] || (nodes[property] = createDataNode(value));
  }
  function proxyDescriptor$1(target, property) {
    const desc = Reflect.getOwnPropertyDescriptor(target, property);
    if (!desc || desc.get || !desc.configurable || property === $PROXY || property === $NODE || property === $NAME) return desc;
    delete desc.value;
    delete desc.writable;
    desc.get = () => target[$PROXY][property];
    return desc;
  }
  function trackSelf(target) {
    if (getListener()) {
      const nodes = getDataNodes(target);
      (nodes._ || (nodes._ = createDataNode()))();
    }
  }
  function ownKeys(target) {
    trackSelf(target);
    return Reflect.ownKeys(target);
  }
  function createDataNode(value) {
    const [s, set] = createSignal(value, {
      equals: false,
      internal: true
    });
    s.$ = set;
    return s;
  }
  const proxyTraps$1 = {
    get(target, property, receiver) {
      if (property === $RAW) return target;
      if (property === $PROXY) return receiver;
      if (property === $TRACK) {
        trackSelf(target);
        return receiver;
      }
      const nodes = getDataNodes(target);
      const tracked = nodes.hasOwnProperty(property);
      let value = tracked ? nodes[property]() : target[property];
      if (property === $NODE || property === "__proto__") return value;
      if (!tracked) {
        const desc = Object.getOwnPropertyDescriptor(target, property);
        if (getListener() && (typeof value !== "function" || target.hasOwnProperty(property)) && !(desc && desc.get)) value = getDataNode(nodes, property, value)();
      }
      return isWrappable(value) ? wrap$1(value) : value;
    },
    has(target, property) {
      if (property === $RAW || property === $PROXY || property === $TRACK || property === $NODE || property === "__proto__") return true;
      this.get(target, property, target);
      return property in target;
    },
    set() {
      return true;
    },
    deleteProperty() {
      return true;
    },
    ownKeys: ownKeys,
    getOwnPropertyDescriptor: proxyDescriptor$1
  };
  function setProperty(state, property, value, deleting = false) {
    if (!deleting && state[property] === value) return;
    const prev = state[property],
      len = state.length;
    if (value === undefined) delete state[property];else state[property] = value;
    let nodes = getDataNodes(state),
      node;
    if (node = getDataNode(nodes, property, prev)) node.$(() => value);
    if (Array.isArray(state) && state.length !== len) (node = getDataNode(nodes, "length", len)) && node.$(state.length);
    (node = nodes._) && node.$();
  }
  function mergeStoreNode(state, value) {
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      setProperty(state, key, value[key]);
    }
  }
  function updateArray(current, next) {
    if (typeof next === "function") next = next(current);
    next = unwrap(next);
    if (Array.isArray(next)) {
      if (current === next) return;
      let i = 0,
        len = next.length;
      for (; i < len; i++) {
        const value = next[i];
        if (current[i] !== value) setProperty(current, i, value);
      }
      setProperty(current, "length", len);
    } else mergeStoreNode(current, next);
  }
  function updatePath(current, path, traversed = []) {
    let part,
      prev = current;
    if (path.length > 1) {
      part = path.shift();
      const partType = typeof part,
        isArray = Array.isArray(current);
      if (Array.isArray(part)) {
        for (let i = 0; i < part.length; i++) {
          updatePath(current, [part[i]].concat(path), traversed);
        }
        return;
      } else if (isArray && partType === "function") {
        for (let i = 0; i < current.length; i++) {
          if (part(current[i], i)) updatePath(current, [i].concat(path), traversed);
        }
        return;
      } else if (isArray && partType === "object") {
        const {
          from = 0,
          to = current.length - 1,
          by = 1
        } = part;
        for (let i = from; i <= to; i += by) {
          updatePath(current, [i].concat(path), traversed);
        }
        return;
      } else if (path.length > 1) {
        updatePath(current[part], path, [part].concat(traversed));
        return;
      }
      prev = current[part];
      traversed = [part].concat(traversed);
    }
    let value = path[0];
    if (typeof value === "function") {
      value = value(prev, traversed);
      if (value === prev) return;
    }
    if (part === undefined && value == undefined) return;
    value = unwrap(value);
    if (part === undefined || isWrappable(prev) && isWrappable(value) && !Array.isArray(value)) {
      mergeStoreNode(prev, value);
    } else setProperty(current, part, value);
  }
  function createStore(...[store, options]) {
    const unwrappedStore = unwrap(store || {});
    const isArray = Array.isArray(unwrappedStore);
    const wrappedStore = wrap$1(unwrappedStore);
    function setStore(...args) {
      batch(() => {
        isArray && args.length === 1 ? updateArray(unwrappedStore, args[0]) : updatePath(unwrappedStore, args);
      });
    }
    return [wrappedStore, setStore];
  }

  const $ROOT = Symbol("store-root");
  function applyState(target, parent, property, merge, key) {
    const previous = parent[property];
    if (target === previous) return;
    if (!isWrappable(target) || !isWrappable(previous) || key && target[key] !== previous[key]) {
      if (target !== previous) {
        if (property === $ROOT) return target;
        setProperty(parent, property, target);
      }
      return;
    }
    if (Array.isArray(target)) {
      if (target.length && previous.length && (!merge || key && target[0] && target[0][key] != null)) {
        let i, j, start, end, newEnd, item, newIndicesNext, keyVal;
        for (start = 0, end = Math.min(previous.length, target.length); start < end && (previous[start] === target[start] || key && previous[start] && target[start] && previous[start][key] === target[start][key]); start++) {
          applyState(target[start], previous, start, merge, key);
        }
        const temp = new Array(target.length),
          newIndices = new Map();
        for (end = previous.length - 1, newEnd = target.length - 1; end >= start && newEnd >= start && (previous[end] === target[newEnd] || key && previous[start] && target[start] && previous[end][key] === target[newEnd][key]); end--, newEnd--) {
          temp[newEnd] = previous[end];
        }
        if (start > newEnd || start > end) {
          for (j = start; j <= newEnd; j++) setProperty(previous, j, target[j]);
          for (; j < target.length; j++) {
            setProperty(previous, j, temp[j]);
            applyState(target[j], previous, j, merge, key);
          }
          if (previous.length > target.length) setProperty(previous, "length", target.length);
          return;
        }
        newIndicesNext = new Array(newEnd + 1);
        for (j = newEnd; j >= start; j--) {
          item = target[j];
          keyVal = key && item ? item[key] : item;
          i = newIndices.get(keyVal);
          newIndicesNext[j] = i === undefined ? -1 : i;
          newIndices.set(keyVal, j);
        }
        for (i = start; i <= end; i++) {
          item = previous[i];
          keyVal = key && item ? item[key] : item;
          j = newIndices.get(keyVal);
          if (j !== undefined && j !== -1) {
            temp[j] = previous[i];
            j = newIndicesNext[j];
            newIndices.set(keyVal, j);
          }
        }
        for (j = start; j < target.length; j++) {
          if (j in temp) {
            setProperty(previous, j, temp[j]);
            applyState(target[j], previous, j, merge, key);
          } else setProperty(previous, j, target[j]);
        }
      } else {
        for (let i = 0, len = target.length; i < len; i++) {
          applyState(target[i], previous, i, merge, key);
        }
      }
      if (previous.length > target.length) setProperty(previous, "length", target.length);
      return;
    }
    const targetKeys = Object.keys(target);
    for (let i = 0, len = targetKeys.length; i < len; i++) {
      applyState(target[targetKeys[i]], previous, targetKeys[i], merge, key);
    }
    const previousKeys = Object.keys(previous);
    for (let i = 0, len = previousKeys.length; i < len; i++) {
      if (target[previousKeys[i]] === undefined) setProperty(previous, previousKeys[i], undefined);
    }
  }
  function reconcile(value, options = {}) {
    const {
        merge,
        key = "id"
      } = options,
      v = unwrap(value);
    return state => {
      if (!isWrappable(state) || !isWrappable(v)) return v;
      const res = applyState(v, {
        [$ROOT]: state
      }, $ROOT, merge, key);
      return res === undefined ? state : res;
    };
  }

  const _tmpl$$9 = /*#__PURE__*/template(`<span></span>`);
  var Segment = (props => {
    const codePoint = createMemo(() => {
      if (props.text.length == 1) {
        const cp = props.text.codePointAt(0);
        if (cp >= 0x2580 && cp <= 0x259f || cp == 0xe0b0 || cp == 0xe0b2) {
          return cp;
        }
      }
    });
    const text = createMemo(() => codePoint() ? " " : props.text);
    const style$1 = createMemo(() => buildStyle(props.pen, props.offset, text().length, props.charWidth));
    const className$1 = createMemo(() => buildClassName(props.pen, codePoint(), props.extraClass));
    return (() => {
      const _el$ = _tmpl$$9.cloneNode(true);
      insert(_el$, text);
      createRenderEffect(_p$ => {
        const _v$ = className$1(),
          _v$2 = style$1();
        _v$ !== _p$._v$ && className(_el$, _p$._v$ = _v$);
        _p$._v$2 = style(_el$, _v$2, _p$._v$2);
        return _p$;
      }, {
        _v$: undefined,
        _v$2: undefined
      });
      return _el$;
    })();
  });
  function buildClassName(attrs, codePoint, extraClass) {
    const fgClass = colorClass(attrs.get("fg"), attrs.get("bold"), "fg-");
    const bgClass = colorClass(attrs.get("bg"), attrs.get("blink"), "bg-");
    let cls = extraClass ?? "";
    if (codePoint !== undefined) {
      cls += ` cp-${codePoint.toString(16)}`;
    }
    if (fgClass) {
      cls += " " + fgClass;
    }
    if (bgClass) {
      cls += " " + bgClass;
    }
    if (attrs.has("bold")) {
      cls += " ap-bright";
    }
    if (attrs.has("faint")) {
      cls += " ap-faint";
    }
    if (attrs.has("italic")) {
      cls += " ap-italic";
    }
    if (attrs.has("underline")) {
      cls += " ap-underline";
    }
    if (attrs.has("blink")) {
      cls += " ap-blink";
    }
    if (attrs.get("inverse")) {
      cls += " ap-inverse";
    }
    return cls;
  }
  function colorClass(color, intense, prefix) {
    if (typeof color === "number") {
      if (intense && color < 8) {
        color += 8;
      }
      return `${prefix}${color}`;
    }
  }
  function buildStyle(attrs, offset, textLen, charWidth) {
    const fg = attrs.get("fg");
    const bg = attrs.get("bg");
    let style = {
      "--offset": offset,
      width: `${textLen * charWidth + 0.01}ch`
    };
    if (typeof fg === "string") {
      style["--fg"] = fg;
    }
    if (typeof bg === "string") {
      style["--bg"] = bg;
    }
    return style;
  }

  const _tmpl$$8 = /*#__PURE__*/template(`<span class="ap-line" role="paragraph"></span>`);
  var Line = (props => {
    const segments = () => {
      if (typeof props.cursor === "number") {
        const segs = [];
        let len = 0;
        let i = 0;
        while (i < props.segments.length && len + props.segments[i].text.length - 1 < props.cursor) {
          const seg = props.segments[i];
          segs.push(seg);
          len += seg.text.length;
          i++;
        }
        if (i < props.segments.length) {
          const seg = props.segments[i];
          const pos = props.cursor - len;
          if (pos > 0) {
            segs.push({
              ...seg,
              text: seg.text.substring(0, pos)
            });
          }
          segs.push({
            ...seg,
            text: seg.text[pos],
            offset: seg.offset + pos,
            extraClass: "ap-cursor"
          });
          if (pos < seg.text.length - 1) {
            segs.push({
              ...seg,
              text: seg.text.substring(pos + 1),
              offset: seg.offset + pos + 1
            });
          }
          i++;
          while (i < props.segments.length) {
            const seg = props.segments[i];
            segs.push(seg);
            i++;
          }
        }
        return segs;
      } else {
        return props.segments;
      }
    };
    return (() => {
      const _el$ = _tmpl$$8.cloneNode(true);
      insert(_el$, createComponent(Index, {
        get each() {
          return segments();
        },
        children: s => createComponent(Segment, mergeProps(s))
      }));
      return _el$;
    })();
  });

  const _tmpl$$7 = /*#__PURE__*/template(`<pre class="ap-terminal" aria-live="polite" tabindex="0"></pre>`);
  var Terminal = (props => {
    const lineHeight = () => props.lineHeight ?? 1.3333333333;
    const style$1 = createMemo(() => {
      return {
        width: `${props.cols}ch`,
        height: `${lineHeight() * props.rows}em`,
        "font-size": `${(props.scale || 1.0) * 100}%`,
        "font-family": props.fontFamily,
        "--term-line-height": `${lineHeight()}em`,
        "--term-cols": props.cols
      };
    });
    const cursorCol = createMemo(() => props.cursor?.[0]);
    const cursorRow = createMemo(() => props.cursor?.[1]);
    return (() => {
      const _el$ = _tmpl$$7.cloneNode(true);
      const _ref$ = props.ref;
      typeof _ref$ === "function" ? use(_ref$, _el$) : props.ref = _el$;
      insert(_el$, createComponent(For, {
        get each() {
          return props.lines;
        },
        children: (line, i) => createComponent(Line, {
          get segments() {
            return line.segments;
          },
          get cursor() {
            return createMemo(() => i() === cursorRow())() ? cursorCol() : null;
          }
        })
      }));
      createRenderEffect(_p$ => {
        const _v$ = !!(props.blink || props.cursorHold),
          _v$2 = !!props.blink,
          _v$3 = style$1();
        _v$ !== _p$._v$ && _el$.classList.toggle("ap-cursor-on", _p$._v$ = _v$);
        _v$2 !== _p$._v$2 && _el$.classList.toggle("ap-blink", _p$._v$2 = _v$2);
        _p$._v$3 = style(_el$, _v$3, _p$._v$3);
        return _p$;
      }, {
        _v$: undefined,
        _v$2: undefined,
        _v$3: undefined
      });
      return _el$;
    })();
  });

  const _tmpl$$6 = /*#__PURE__*/template(`<svg version="1.1" viewBox="0 0 12 12" class="ap-icon" aria-label="Pause" role="button"><path d="M1,0 L4,0 L4,12 L1,12 Z"></path><path d="M8,0 L11,0 L11,12 L8,12 Z"></path></svg>`),
    _tmpl$2 = /*#__PURE__*/template(`<svg version="1.1" viewBox="0 0 12 12" class="ap-icon" aria-label="Play" role="button"><path d="M1,0 L11,6 L1,12 Z"></path></svg>`),
    _tmpl$3 = /*#__PURE__*/template(`<span class="ap-playback-button" tabindex="0"></span>`),
    _tmpl$4 = /*#__PURE__*/template(`<span class="ap-progressbar"><span class="ap-bar"><span class="ap-gutter ap-gutter-empty"></span><span class="ap-gutter ap-gutter-full"></span></span></span>`),
    _tmpl$5 = /*#__PURE__*/template(`<div class="ap-control-bar"><span class="ap-timer" aria-readonly="true" role="textbox" tabindex="0"><span class="ap-time-elapsed"></span><span class="ap-time-remaining"></span></span><span class="ap-fullscreen-button ap-tooltip-container" aria-label="Toggle fullscreen mode" role="button" tabindex="0"><svg version="1.1" viewBox="0 0 12 12" class="ap-icon ap-icon-fullscreen-on"><path d="M12,0 L7,0 L9,2 L7,4 L8,5 L10,3 L12,5 Z"></path><path d="M0,12 L0,7 L2,9 L4,7 L5,8 L3,10 L5,12 Z"></path></svg><svg version="1.1" viewBox="0 0 12 12" class="ap-icon ap-icon-fullscreen-off"><path d="M7,5 L7,0 L9,2 L11,0 L12,1 L10,3 L12,5 Z"></path><path d="M5,7 L0,7 L2,9 L0,11 L1,12 L3,10 L5,12 Z"></path></svg><span class="ap-tooltip">Fullscreen (f)</span></span></div>`),
    _tmpl$6 = /*#__PURE__*/template(`<span class="ap-marker-container ap-tooltip-container"><span class="ap-marker"></span><span class="ap-tooltip"></span></span>`);
  function formatTime(seconds) {
    let s = Math.floor(seconds);
    const d = Math.floor(s / 86400);
    s %= 86400;
    const h = Math.floor(s / 3600);
    s %= 3600;
    const m = Math.floor(s / 60);
    s %= 60;
    if (d > 0) {
      return `${zeroPad(d)}:${zeroPad(h)}:${zeroPad(m)}:${zeroPad(s)}`;
    } else if (h > 0) {
      return `${zeroPad(h)}:${zeroPad(m)}:${zeroPad(s)}`;
    } else {
      return `${zeroPad(m)}:${zeroPad(s)}`;
    }
  }
  function zeroPad(n) {
    return n < 10 ? `0${n}` : n.toString();
  }
  var ControlBar = (props => {
    const e = f => {
      return e => {
        e.preventDefault();
        f(e);
      };
    };
    const currentTime = () => typeof props.currentTime === "number" ? formatTime(props.currentTime) : "--:--";
    const remainingTime = () => typeof props.remainingTime === "number" ? "-" + formatTime(props.remainingTime) : currentTime();
    const markers = createMemo(() => typeof props.duration === "number" ? props.markers.filter(m => m[0] < props.duration) : []);
    const markerPosition = m => `${m[0] / props.duration * 100}%`;
    const markerText = m => {
      if (m[1] === "") {
        return formatTime(m[0]);
      } else {
        return `${formatTime(m[0])} - ${m[1]}`;
      }
    };
    const isPastMarker = m => typeof props.currentTime === "number" ? m[0] <= props.currentTime : false;
    const gutterBarStyle = () => {
      return {
        transform: `scaleX(${props.progress || 0}`
      };
    };
    const calcPosition = e => {
      const barWidth = e.currentTarget.offsetWidth;
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const pos = Math.max(0, mouseX / barWidth);
      return `${pos * 100}%`;
    };
    const [mouseDown, setMouseDown] = createSignal(false);
    const throttledSeek = throttle(props.onSeekClick, 50);
    const onMouseDown = e => {
      if (e._marker) return;
      if (e.altKey || e.shiftKey || e.metaKey || e.ctrlKey || e.button !== 0) return;
      setMouseDown(true);
      props.onSeekClick(calcPosition(e));
    };
    const seekToMarker = index => {
      return e(() => {
        props.onSeekClick({
          marker: index
        });
      });
    };
    const onMove = e => {
      if (e.altKey || e.shiftKey || e.metaKey || e.ctrlKey) return;
      if (mouseDown()) {
        throttledSeek(calcPosition(e));
      }
    };
    const onDocumentMouseUp = () => {
      setMouseDown(false);
    };
    document.addEventListener("mouseup", onDocumentMouseUp);
    onCleanup(() => {
      document.removeEventListener("mouseup", onDocumentMouseUp);
    });
    return (() => {
      const _el$ = _tmpl$5.cloneNode(true),
        _el$5 = _el$.firstChild,
        _el$6 = _el$5.firstChild,
        _el$7 = _el$6.nextSibling,
        _el$12 = _el$5.nextSibling;
      const _ref$ = props.ref;
      typeof _ref$ === "function" ? use(_ref$, _el$) : props.ref = _el$;
      insert(_el$, createComponent(Show, {
        get when() {
          return props.isPausable;
        },
        get children() {
          const _el$2 = _tmpl$3.cloneNode(true);
          addEventListener(_el$2, "click", e(props.onPlayClick), true);
          insert(_el$2, createComponent(Switch, {
            get children() {
              return [createComponent(Match, {
                get when() {
                  return props.isPlaying;
                },
                get children() {
                  return _tmpl$$6.cloneNode(true);
                }
              }), createComponent(Match, {
                get when() {
                  return !props.isPlaying;
                },
                get children() {
                  return _tmpl$2.cloneNode(true);
                }
              })];
            }
          }));
          return _el$2;
        }
      }), _el$5);
      insert(_el$6, currentTime);
      insert(_el$7, remainingTime);
      insert(_el$, createComponent(Show, {
        get when() {
          return typeof props.progress === "number" || props.isSeekable;
        },
        get children() {
          const _el$8 = _tmpl$4.cloneNode(true),
            _el$9 = _el$8.firstChild,
            _el$10 = _el$9.firstChild,
            _el$11 = _el$10.nextSibling;
          _el$9.$$mousemove = onMove;
          _el$9.$$mousedown = onMouseDown;
          insert(_el$9, createComponent(For, {
            get each() {
              return markers();
            },
            children: (m, i) => (() => {
              const _el$13 = _tmpl$6.cloneNode(true),
                _el$14 = _el$13.firstChild,
                _el$15 = _el$14.nextSibling;
              _el$13.$$mousedown = e => {
                e._marker = true;
              };
              addEventListener(_el$13, "click", seekToMarker(i()), true);
              insert(_el$15, () => markerText(m));
              createRenderEffect(_p$ => {
                const _v$ = markerPosition(m),
                  _v$2 = !!isPastMarker(m);
                _v$ !== _p$._v$ && _el$13.style.setProperty("left", _p$._v$ = _v$);
                _v$2 !== _p$._v$2 && _el$14.classList.toggle("ap-marker-past", _p$._v$2 = _v$2);
                return _p$;
              }, {
                _v$: undefined,
                _v$2: undefined
              });
              return _el$13;
            })()
          }), null);
          createRenderEffect(_$p => style(_el$11, gutterBarStyle(), _$p));
          return _el$8;
        }
      }), _el$12);
      addEventListener(_el$12, "click", e(props.onFullscreenClick), true);
      createRenderEffect(() => _el$.classList.toggle("ap-seekable", !!props.isSeekable));
      return _el$;
    })();
  });
  delegateEvents(["click", "mousedown", "mousemove"]);

  const _tmpl$$5 = /*#__PURE__*/template(`<div class="ap-overlay ap-overlay-error"><span>💥</span></div>`);
  var ErrorOverlay = (props => {
    return _tmpl$$5.cloneNode(true);
  });

  const _tmpl$$4 = /*#__PURE__*/template(`<div class="ap-overlay ap-overlay-loading"><span class="ap-loader"></span></div>`);
  var LoaderOverlay = (props => {
    return _tmpl$$4.cloneNode(true);
  });

  const _tmpl$$3 = /*#__PURE__*/template(`<div class="ap-overlay ap-overlay-info"><span></span></div>`);
  var InfoOverlay = (props => {
    const style$1 = () => {
      return {
        "font-family": props.fontFamily
      };
    };
    return (() => {
      const _el$ = _tmpl$$3.cloneNode(true),
        _el$2 = _el$.firstChild;
      insert(_el$2, () => props.message);
      createRenderEffect(_$p => style(_el$2, style$1(), _$p));
      return _el$;
    })();
  });

  const _tmpl$$2 = /*#__PURE__*/template(`<div class="ap-overlay ap-overlay-start"><div class="ap-play-button"><div><span><svg version="1.1" viewBox="0 0 1000.0 1000.0" class="ap-icon"><defs><mask id="small-triangle-mask"><rect width="100%" height="100%" fill="white"></rect><polygon points="700.0 500.0, 400.00000000000006 326.7949192431122, 399.9999999999999 673.2050807568877" fill="black"></polygon></mask></defs><polygon points="1000.0 500.0, 250.0000000000001 66.98729810778059, 249.99999999999977 933.0127018922192" mask="url(#small-triangle-mask)" fill="white" class="ap-play-btn-fill"></polygon><polyline points="673.2050807568878 400.0, 326.7949192431123 600.0" stroke="white" stroke-width="90" class="ap-play-btn-stroke"></polyline></svg></span></div></div></div>`);
  var StartOverlay = (props => {
    const e = f => {
      return e => {
        e.preventDefault();
        f(e);
      };
    };
    return (() => {
      const _el$ = _tmpl$$2.cloneNode(true);
      addEventListener(_el$, "click", e(props.onClick), true);
      return _el$;
    })();
  });
  delegateEvents(["click"]);

  const _tmpl$$1 = /*#__PURE__*/template(`<div class="ap-overlay ap-overlay-help"><div><div><p>Keyboard shortcuts</p><ul><li><kbd>space</kbd> - pause / resume</li><li><kbd>f</kbd> - toggle fullscreen mode</li><li><kbd>←</kbd> / <kbd>→</kbd> - rewind / fast-forward by 5 seconds</li><li><kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd> - rewind / fast-forward by 10%</li><li><kbd>[</kbd> / <kbd>]</kbd> - jump to the previous / next marker</li><li><kbd>0</kbd>, <kbd>1</kbd>, <kbd>2</kbd> ... <kbd>9</kbd> - jump to 0%, 10%, 20% ... 90%</li><li><kbd>.</kbd> - step through a recording, one frame at a time (when paused)</li><li><kbd>?</kbd> - toggle this help popup</li></ul></div></div></div>`);
  var HelpOverlay = (props => {
    const style$1 = () => {
      return {
        "font-family": props.fontFamily
      };
    };
    const e = f => {
      return e => {
        e.preventDefault();
        f(e);
      };
    };
    return (() => {
      const _el$ = _tmpl$$1.cloneNode(true),
        _el$2 = _el$.firstChild;
      addEventListener(_el$, "click", e(props.onClose), true);
      _el$2.$$click = e => {
        e.stopPropagation();
      };
      createRenderEffect(_$p => style(_el$, style$1(), _$p));
      return _el$;
    })();
  });
  delegateEvents(["click"]);

  const _tmpl$ = /*#__PURE__*/template(`<div class="ap-wrapper" tabindex="-1"><div></div></div>`);
  const CONTROL_BAR_HEIGHT = 32; // must match height of div.ap-control-bar in CSS

  var Player = (props => {
    const logger = props.logger;
    const core = props.core;
    const autoPlay = props.autoPlay;
    const [state, setState] = createStore({
      lines: [],
      cursor: undefined,
      charW: props.charW,
      charH: props.charH,
      bordersW: props.bordersW,
      bordersH: props.bordersH,
      containerW: 0,
      containerH: 0,
      isPausable: true,
      isSeekable: true,
      isFullscreen: false,
      currentTime: null,
      remainingTime: null,
      progress: null,
      blink: true,
      cursorHold: false
    });
    const [isPlaying, setIsPlaying] = createSignal(false);
    const [overlay, setOverlay] = createSignal(!autoPlay ? "start" : null);
    const [infoMessage, setInfoMessage] = createSignal(null);
    const [terminalSize, setTerminalSize] = createSignal({
      cols: props.cols,
      rows: props.rows
    }, {
      equals: (newVal, oldVal) => newVal.cols === oldVal.cols && newVal.rows === oldVal.rows
    });
    const [duration, setDuration] = createSignal(undefined);
    const [markers, setMarkers] = createStore([]);
    const [userActive, setUserActive] = createSignal(false);
    const [isHelpVisible, setIsHelpVisible] = createSignal(false);
    const [originalTheme, setOriginalTheme] = createSignal(undefined);
    const terminalCols = createMemo(() => terminalSize().cols || 80);
    const terminalRows = createMemo(() => terminalSize().rows || 24);
    const controlBarHeight = () => props.controls === false ? 0 : CONTROL_BAR_HEIGHT;
    const controlsVisible = () => props.controls === true || props.controls === "auto" && userActive();
    let frameRequestId;
    let userActivityTimeoutId;
    let timeUpdateIntervalId;
    let blinkIntervalId;
    let wrapperRef;
    let playerRef;
    let terminalRef;
    let controlBarRef;
    let resizeObserver;
    function onPlaying() {
      updateTerminal();
      startBlinking();
      startTimeUpdates();
    }
    function onStopped() {
      stopBlinking();
      stopTimeUpdates();
      updateTime();
    }
    function resize(size_) {
      batch(() => {
        if (size_.rows < terminalSize().rows) {
          setState("lines", state.lines.slice(0, size_.rows));
        }
        setTerminalSize(size_);
      });
    }
    function setPoster(poster) {
      if (poster !== undefined && !autoPlay) {
        setState({
          lines: poster.lines,
          cursor: poster.cursor
        });
      }
    }
    core.addEventListener("init", _ref => {
      let {
        cols,
        rows,
        duration,
        theme,
        poster,
        markers
      } = _ref;
      batch(() => {
        resize({
          cols,
          rows
        });
        setDuration(duration);
        setOriginalTheme(theme);
        setMarkers(markers);
        setPoster(poster);
      });
    });
    core.addEventListener("play", () => {
      setOverlay(null);
    });
    core.addEventListener("playing", () => {
      batch(() => {
        setIsPlaying(true);
        setOverlay(null);
        onPlaying();
      });
    });
    core.addEventListener("idle", () => {
      batch(() => {
        setIsPlaying(false);
        onStopped();
      });
    });
    core.addEventListener("loading", () => {
      batch(() => {
        setIsPlaying(false);
        onStopped();
        setOverlay("loader");
      });
    });
    core.addEventListener("offline", _ref2 => {
      let {
        message
      } = _ref2;
      batch(() => {
        setIsPlaying(false);
        onStopped();
        if (message !== undefined) {
          setInfoMessage(message);
          setOverlay("info");
        }
      });
    });
    core.addEventListener("ended", _ref3 => {
      let {
        message
      } = _ref3;
      batch(() => {
        setIsPlaying(false);
        onStopped();
        if (message !== undefined) {
          setInfoMessage(message);
          setOverlay("info");
        }
      });
    });
    core.addEventListener("errored", () => {
      setOverlay("error");
    });
    core.addEventListener("resize", resize);
    core.addEventListener("reset", _ref4 => {
      let {
        cols,
        rows,
        theme
      } = _ref4;
      batch(() => {
        resize({
          cols,
          rows
        });
        setOriginalTheme(theme);
        updateTerminal();
      });
    });
    core.addEventListener("seeked", () => {
      updateTime();
    });
    core.addEventListener("terminalUpdate", () => {
      if (frameRequestId === undefined) {
        frameRequestId = requestAnimationFrame(updateTerminal);
      }
    });
    const setupResizeObserver = () => {
      resizeObserver = new ResizeObserver(debounce(_entries => {
        setState({
          containerW: wrapperRef.offsetWidth,
          containerH: wrapperRef.offsetHeight
        });
        wrapperRef.dispatchEvent(new CustomEvent("resize", {
          detail: {
            el: playerRef
          }
        }));
      }, 10));
      resizeObserver.observe(wrapperRef);
    };
    onMount(async () => {
      logger.info("player mounted");
      logger.debug("font measurements", {
        charW: state.charW,
        charH: state.charH
      });
      setupResizeObserver();
      const {
        isPausable,
        isSeekable,
        poster
      } = await core.init();
      batch(() => {
        setState({
          isPausable,
          isSeekable,
          containerW: wrapperRef.offsetWidth,
          containerH: wrapperRef.offsetHeight
        });
        setPoster(poster);
      });
      if (autoPlay) {
        core.play();
      }
    });
    onCleanup(() => {
      core.stop();
      stopBlinking();
      stopTimeUpdates();
      resizeObserver.disconnect();
    });
    const updateTerminal = () => {
      const changedLines = core.getChangedLines();
      batch(() => {
        if (changedLines) {
          changedLines.forEach((line, i) => {
            setState("lines", i, reconcile(line));
          });
        }
        setState("cursor", reconcile(core.getCursor()));
        setState("cursorHold", true);
      });
      frameRequestId = undefined;
    };
    const terminalElementSize = createMemo(() => {
      const terminalW = state.charW * terminalCols() + state.bordersW;
      const terminalH = state.charH * terminalRows() + state.bordersH;
      let fit = props.fit ?? "width";
      if (fit === "both" || state.isFullscreen) {
        const containerRatio = state.containerW / (state.containerH - controlBarHeight());
        const terminalRatio = terminalW / terminalH;
        if (containerRatio > terminalRatio) {
          fit = "height";
        } else {
          fit = "width";
        }
      }
      if (fit === false || fit === "none") {
        return {};
      } else if (fit === "width") {
        const scale = state.containerW / terminalW;
        return {
          scale: scale,
          width: state.containerW,
          height: terminalH * scale + controlBarHeight()
        };
      } else if (fit === "height") {
        const scale = (state.containerH - controlBarHeight()) / terminalH;
        return {
          scale: scale,
          width: terminalW * scale,
          height: state.containerH
        };
      } else {
        throw `unsupported fit mode: ${fit}`;
      }
    });
    const onFullscreenChange = () => {
      setState("isFullscreen", document.fullscreenElement ?? document.webkitFullscreenElement);
    };
    const toggleFullscreen = () => {
      if (state.isFullscreen) {
        (document.exitFullscreen ?? document.webkitExitFullscreen ?? (() => {})).apply(document);
      } else {
        (wrapperRef.requestFullscreen ?? wrapperRef.webkitRequestFullscreen ?? (() => {})).apply(wrapperRef);
      }
    };
    const onKeyDown = e => {
      if (e.altKey || e.metaKey || e.ctrlKey) {
        return;
      }
      if (e.key == " ") {
        core.togglePlay();
      } else if (e.key == ".") {
        core.step();
        updateTime();
      } else if (e.key == "f") {
        toggleFullscreen();
      } else if (e.key == "[") {
        core.seek({
          marker: "prev"
        });
      } else if (e.key == "]") {
        core.seek({
          marker: "next"
        });
      } else if (e.key.charCodeAt(0) >= 48 && e.key.charCodeAt(0) <= 57) {
        const pos = (e.key.charCodeAt(0) - 48) / 10;
        core.seek(`${pos * 100}%`);
      } else if (e.key == "?") {
        if (isHelpVisible()) {
          setIsHelpVisible(false);
        } else {
          core.pause();
          setIsHelpVisible(true);
        }
      } else if (e.key == "ArrowLeft") {
        if (e.shiftKey) {
          core.seek("<<<");
        } else {
          core.seek("<<");
        }
      } else if (e.key == "ArrowRight") {
        if (e.shiftKey) {
          core.seek(">>>");
        } else {
          core.seek(">>");
        }
      } else if (e.key == "Escape") {
        setIsHelpVisible(false);
      } else {
        return;
      }
      e.stopPropagation();
      e.preventDefault();
    };
    const wrapperOnMouseMove = () => {
      if (state.isFullscreen) {
        onUserActive(true);
      }
    };
    const playerOnMouseLeave = () => {
      if (!state.isFullscreen) {
        onUserActive(false);
      }
    };
    const startTimeUpdates = () => {
      timeUpdateIntervalId = setInterval(updateTime, 100);
    };
    const stopTimeUpdates = () => {
      clearInterval(timeUpdateIntervalId);
    };
    const updateTime = () => {
      const currentTime = core.getCurrentTime();
      const remainingTime = core.getRemainingTime();
      const progress = core.getProgress();
      setState({
        currentTime,
        remainingTime,
        progress
      });
    };
    const startBlinking = () => {
      blinkIntervalId = setInterval(() => {
        setState(state => {
          const changes = {
            blink: !state.blink
          };
          if (changes.blink) {
            changes.cursorHold = false;
          }
          return changes;
        });
      }, 500);
    };
    const stopBlinking = () => {
      clearInterval(blinkIntervalId);
      setState("blink", true);
    };
    const onUserActive = show => {
      clearTimeout(userActivityTimeoutId);
      if (show) {
        userActivityTimeoutId = setTimeout(() => onUserActive(false), 2000);
      }
      setUserActive(show);
    };
    const theme = createMemo(() => {
      const name = props.theme || "auto/asciinema";
      if (name.slice(0, 5) === "auto/") {
        return {
          name: name.slice(5),
          colors: originalTheme()
        };
      } else {
        return {
          name
        };
      }
    });
    const playerStyle = () => {
      const style = {};
      if ((props.fit === false || props.fit === "none") && props.terminalFontSize !== undefined) {
        if (props.terminalFontSize === "small") {
          style["font-size"] = "12px";
        } else if (props.terminalFontSize === "medium") {
          style["font-size"] = "18px";
        } else if (props.terminalFontSize === "big") {
          style["font-size"] = "24px";
        } else {
          style["font-size"] = props.terminalFontSize;
        }
      }
      const size = terminalElementSize();
      if (size.width !== undefined) {
        style["width"] = `${size.width}px`;
        style["height"] = `${size.height}px`;
      }
      const themeColors = theme().colors;
      if (themeColors !== undefined) {
        style["--term-color-foreground"] = themeColors.foreground;
        style["--term-color-background"] = themeColors.background;
        themeColors.palette.forEach((color, i) => {
          style[`--term-color-${i}`] = color;
        });
      }
      return style;
    };
    const playerClass = () => `ap-player asciinema-player-theme-${theme().name}`;
    const terminalScale = () => terminalElementSize()?.scale;
    const el = (() => {
      const _el$ = _tmpl$.cloneNode(true),
        _el$2 = _el$.firstChild;
      const _ref$ = wrapperRef;
      typeof _ref$ === "function" ? use(_ref$, _el$) : wrapperRef = _el$;
      _el$.addEventListener("webkitfullscreenchange", onFullscreenChange);
      _el$.addEventListener("fullscreenchange", onFullscreenChange);
      _el$.$$mousemove = wrapperOnMouseMove;
      _el$.$$keydown = onKeyDown;
      const _ref$2 = playerRef;
      typeof _ref$2 === "function" ? use(_ref$2, _el$2) : playerRef = _el$2;
      _el$2.$$mousemove = () => onUserActive(true);
      _el$2.addEventListener("mouseleave", playerOnMouseLeave);
      insert(_el$2, createComponent(Terminal, {
        get cols() {
          return terminalCols();
        },
        get rows() {
          return terminalRows();
        },
        get scale() {
          return terminalScale();
        },
        get blink() {
          return state.blink;
        },
        get lines() {
          return state.lines;
        },
        get cursor() {
          return state.cursor;
        },
        get cursorHold() {
          return state.cursorHold;
        },
        get fontFamily() {
          return props.terminalFontFamily;
        },
        get lineHeight() {
          return props.terminalLineHeight;
        },
        ref(r$) {
          const _ref$3 = terminalRef;
          typeof _ref$3 === "function" ? _ref$3(r$) : terminalRef = r$;
        }
      }), null);
      insert(_el$2, createComponent(Show, {
        get when() {
          return props.controls !== false;
        },
        get children() {
          return createComponent(ControlBar, {
            get duration() {
              return duration();
            },
            get currentTime() {
              return state.currentTime;
            },
            get remainingTime() {
              return state.remainingTime;
            },
            get progress() {
              return state.progress;
            },
            markers: markers,
            get isPlaying() {
              return isPlaying();
            },
            get isPausable() {
              return state.isPausable;
            },
            get isSeekable() {
              return state.isSeekable;
            },
            onPlayClick: () => core.togglePlay(),
            onFullscreenClick: toggleFullscreen,
            onSeekClick: pos => core.seek(pos),
            ref(r$) {
              const _ref$4 = controlBarRef;
              typeof _ref$4 === "function" ? _ref$4(r$) : controlBarRef = r$;
            }
          });
        }
      }), null);
      insert(_el$2, createComponent(Switch, {
        get children() {
          return [createComponent(Match, {
            get when() {
              return overlay() == "start";
            },
            get children() {
              return createComponent(StartOverlay, {
                onClick: () => core.play()
              });
            }
          }), createComponent(Match, {
            get when() {
              return overlay() == "loader";
            },
            get children() {
              return createComponent(LoaderOverlay, {});
            }
          }), createComponent(Match, {
            get when() {
              return overlay() == "info";
            },
            get children() {
              return createComponent(InfoOverlay, {
                get message() {
                  return infoMessage();
                },
                get fontFamily() {
                  return props.terminalFontFamily;
                }
              });
            }
          }), createComponent(Match, {
            get when() {
              return overlay() == "error";
            },
            get children() {
              return createComponent(ErrorOverlay, {});
            }
          })];
        }
      }), null);
      insert(_el$2, createComponent(Show, {
        get when() {
          return isHelpVisible();
        },
        get children() {
          return createComponent(HelpOverlay, {
            get fontFamily() {
              return props.terminalFontFamily;
            },
            onClose: () => setIsHelpVisible(false)
          });
        }
      }), null);
      createRenderEffect(_p$ => {
        const _v$ = !!controlsVisible(),
          _v$2 = playerClass(),
          _v$3 = playerStyle();
        _v$ !== _p$._v$ && _el$.classList.toggle("ap-hud", _p$._v$ = _v$);
        _v$2 !== _p$._v$2 && className(_el$2, _p$._v$2 = _v$2);
        _p$._v$3 = style(_el$2, _v$3, _p$._v$3);
        return _p$;
      }, {
        _v$: undefined,
        _v$2: undefined,
        _v$3: undefined
      });
      return _el$;
    })();
    return el;
  });
  delegateEvents(["keydown", "mousemove"]);

  class DummyLogger {
    log() {}
    debug() {}
    info() {}
    warn() {}
    error() {}
  }
  class PrefixedLogger {
    constructor(logger, prefix) {
      this.logger = logger;
      this.prefix = prefix;
    }
    log(message) {
      for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        args[_key - 1] = arguments[_key];
      }
      this.logger.log(`${this.prefix}${message}`, ...args);
    }
    debug(message) {
      for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
        args[_key2 - 1] = arguments[_key2];
      }
      this.logger.debug(`${this.prefix}${message}`, ...args);
    }
    info(message) {
      for (var _len3 = arguments.length, args = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
        args[_key3 - 1] = arguments[_key3];
      }
      this.logger.info(`${this.prefix}${message}`, ...args);
    }
    warn(message) {
      for (var _len4 = arguments.length, args = new Array(_len4 > 1 ? _len4 - 1 : 0), _key4 = 1; _key4 < _len4; _key4++) {
        args[_key4 - 1] = arguments[_key4];
      }
      this.logger.warn(`${this.prefix}${message}`, ...args);
    }
    error(message) {
      for (var _len5 = arguments.length, args = new Array(_len5 > 1 ? _len5 - 1 : 0), _key5 = 1; _key5 < _len5; _key5++) {
        args[_key5 - 1] = arguments[_key5];
      }
      this.logger.error(`${this.prefix}${message}`, ...args);
    }
  }

  // Efficient array transformations without intermediate array objects.
  // Inspired by Elixir's streams and Rust's iterator adapters.

  class Stream {
    constructor(input, xfs) {
      this.input = typeof input.next === "function" ? input : input[Symbol.iterator]();
      this.xfs = xfs ?? [];
    }
    map(f) {
      return this.transform(Map$1(f));
    }
    flatMap(f) {
      return this.transform(FlatMap(f));
    }
    filter(f) {
      return this.transform(Filter(f));
    }
    take(n) {
      return this.transform(Take(n));
    }
    drop(n) {
      return this.transform(Drop(n));
    }
    transform(f) {
      return new Stream(this.input, this.xfs.concat([f]));
    }
    multiplex(other, comparator) {
      return new Stream(new Multiplexer(this[Symbol.iterator](), other[Symbol.iterator](), comparator));
    }
    toArray() {
      return Array.from(this);
    }
    [Symbol.iterator]() {
      let v = 0;
      let values = [];
      let flushed = false;
      const xf = compose(this.xfs, val => values.push(val));
      return {
        next: () => {
          if (v === values.length) {
            values = [];
            v = 0;
          }
          while (values.length === 0) {
            const next = this.input.next();
            if (next.done) {
              break;
            } else {
              xf.step(next.value);
            }
          }
          if (values.length === 0 && !flushed) {
            xf.flush();
            flushed = true;
          }
          if (values.length > 0) {
            return {
              done: false,
              value: values[v++]
            };
          } else {
            return {
              done: true
            };
          }
        }
      };
    }
  }
  function Map$1(f) {
    return emit => {
      return input => {
        emit(f(input));
      };
    };
  }
  function FlatMap(f) {
    return emit => {
      return input => {
        f(input).forEach(emit);
      };
    };
  }
  function Filter(f) {
    return emit => {
      return input => {
        if (f(input)) {
          emit(input);
        }
      };
    };
  }
  function Take(n) {
    let c = 0;
    return emit => {
      return input => {
        if (c < n) {
          emit(input);
        }
        c += 1;
      };
    };
  }
  function Drop(n) {
    let c = 0;
    return emit => {
      return input => {
        c += 1;
        if (c > n) {
          emit(input);
        }
      };
    };
  }
  function compose(xfs, push) {
    return xfs.reverse().reduce((next, curr) => {
      const xf = toXf(curr(next.step));
      return {
        step: xf.step,
        flush: () => {
          xf.flush();
          next.flush();
        }
      };
    }, toXf(push));
  }
  function toXf(xf) {
    if (typeof xf === "function") {
      return {
        step: xf,
        flush: () => {}
      };
    } else {
      return xf;
    }
  }
  class Multiplexer {
    constructor(left, right, comparator) {
      this.left = left;
      this.right = right;
      this.comparator = comparator;
    }
    [Symbol.iterator]() {
      let leftItem;
      let rightItem;
      return {
        next: () => {
          if (leftItem === undefined && this.left !== undefined) {
            const result = this.left.next();
            if (result.done) {
              this.left = undefined;
            } else {
              leftItem = result.value;
            }
          }
          if (rightItem === undefined && this.right !== undefined) {
            const result = this.right.next();
            if (result.done) {
              this.right = undefined;
            } else {
              rightItem = result.value;
            }
          }
          if (leftItem === undefined && rightItem === undefined) {
            return {
              done: true
            };
          } else if (leftItem === undefined) {
            const value = rightItem;
            rightItem = undefined;
            return {
              done: false,
              value: value
            };
          } else if (rightItem === undefined) {
            const value = leftItem;
            leftItem = undefined;
            return {
              done: false,
              value: value
            };
          } else if (this.comparator(leftItem, rightItem)) {
            const value = leftItem;
            leftItem = undefined;
            return {
              done: false,
              value: value
            };
          } else {
            const value = rightItem;
            rightItem = undefined;
            return {
              done: false,
              value: value
            };
          }
        }
      };
    }
  }

  async function parse$2(data) {
    let header;
    let events;
    if (data instanceof Response) {
      const text = await data.text();
      const result = parseJsonl(text);
      if (result !== undefined) {
        header = result.header;
        events = result.events;
      } else {
        header = JSON.parse(text);
      }
    } else if (typeof data === "object" && typeof data.version === "number") {
      header = data;
    } else if (Array.isArray(data)) {
      header = data[0];
      events = data.slice(1, data.length);
    } else {
      throw "invalid data";
    }
    if (header.version === 1) {
      return parseAsciicastV1(header);
    } else if (header.version === 2) {
      return parseAsciicastV2(header, events);
    } else {
      throw `asciicast v${header.version} format not supported`;
    }
  }
  function parseJsonl(jsonl) {
    const lines = jsonl.split("\n");
    let header;
    try {
      header = JSON.parse(lines[0]);
    } catch (_error) {
      return;
    }
    const events = new Stream(lines).drop(1).filter(l => l[0] === "[").map(JSON.parse).toArray();
    return {
      header,
      events
    };
  }
  function parseAsciicastV1(data) {
    let time = 0;
    const events = new Stream(data.stdout).map(e => {
      time += e[0];
      return [time, "o", e[1]];
    });
    return {
      cols: data.width,
      rows: data.height,
      events
    };
  }
  function parseAsciicastV2(header, events) {
    return {
      cols: header.width,
      rows: header.height,
      theme: parseTheme(header.theme),
      events,
      idleTimeLimit: header.idle_time_limit
    };
  }
  function parseTheme(theme) {
    const colorRegex = /^#[0-9A-Fa-f]{6}$/;
    const paletteRegex = /^(#[0-9A-Fa-f]{6}:){7,}#[0-9A-Fa-f]{6}$/;
    const fg = theme?.fg;
    const bg = theme?.bg;
    const palette = theme?.palette;
    if (colorRegex.test(fg) && colorRegex.test(bg) && paletteRegex.test(palette)) {
      return {
        foreground: fg,
        background: bg,
        palette: palette.split(":")
      };
    }
  }
  function unparseAsciicastV2(recording) {
    const header = JSON.stringify({
      version: 2,
      width: recording.cols,
      height: recording.rows
    });
    const events = recording.events.map(JSON.stringify).join("\n");
    return `${header}\n${events}\n`;
  }

  function recording(src, _ref, _ref2) {
    let {
      feed,
      onInput,
      onMarker,
      now,
      setTimeout,
      setState,
      logger
    } = _ref;
    let {
      idleTimeLimit,
      startAt,
      loop,
      posterTime,
      markers: markers_,
      pauseOnMarkers,
      cols: initialCols,
      rows: initialRows
    } = _ref2;
    let cols;
    let rows;
    let events;
    let markers;
    let duration;
    let effectiveStartAt;
    let eventTimeoutId;
    let nextEventIndex = 0;
    let lastEventTime = 0;
    let startTime;
    let pauseElapsedTime;
    let playCount = 0;
    async function init() {
      const {
        parser,
        minFrameTime,
        inputOffset,
        dumpFilename,
        encoding = "utf-8"
      } = src;
      const recording = prepare(await parser(await doFetch(src), {
        encoding
      }), logger, {
        idleTimeLimit,
        startAt,
        minFrameTime,
        inputOffset,
        markers_
      });
      ({
        cols,
        rows,
        events,
        duration,
        effectiveStartAt
      } = recording);
      initialCols = initialCols ?? cols;
      initialRows = initialRows ?? rows;
      if (events.length === 0) {
        throw "recording is missing events";
      }
      if (dumpFilename !== undefined) {
        dump(recording, dumpFilename);
      }
      const poster = posterTime !== undefined ? getPoster(posterTime) : undefined;
      markers = events.filter(e => e[1] === "m").map(e => [e[0], e[2].label]);
      return {
        cols,
        rows,
        duration,
        theme: recording.theme,
        poster,
        markers
      };
    }
    function doFetch(_ref3) {
      let {
        url,
        data,
        fetchOpts = {}
      } = _ref3;
      if (typeof url === "string") {
        return doFetchOne(url, fetchOpts);
      } else if (Array.isArray(url)) {
        return Promise.all(url.map(url => doFetchOne(url, fetchOpts)));
      } else if (data !== undefined) {
        if (typeof data === "function") {
          data = data();
        }
        if (!(data instanceof Promise)) {
          data = Promise.resolve(data);
        }
        return data.then(value => {
          if (typeof value === "string" || value instanceof ArrayBuffer) {
            return new Response(value);
          } else {
            return value;
          }
        });
      } else {
        throw "failed fetching recording file: url/data missing in src";
      }
    }
    async function doFetchOne(url, fetchOpts) {
      const response = await fetch(url, fetchOpts);
      if (!response.ok) {
        throw `failed fetching recording from ${url}: ${response.status} ${response.statusText}`;
      }
      return response;
    }
    function delay(targetTime) {
      let delay = targetTime * 1000 - (now() - startTime);
      if (delay < 0) {
        delay = 0;
      }
      return delay;
    }
    function scheduleNextEvent() {
      const nextEvent = events[nextEventIndex];
      if (nextEvent) {
        eventTimeoutId = setTimeout(runNextEvent, delay(nextEvent[0]));
      } else {
        onEnd();
      }
    }
    function runNextEvent() {
      let event = events[nextEventIndex];
      let elapsedWallTime;
      do {
        lastEventTime = event[0];
        nextEventIndex++;
        const stop = executeEvent(event);
        if (stop) {
          return;
        }
        event = events[nextEventIndex];
        elapsedWallTime = now() - startTime;
      } while (event && elapsedWallTime > event[0] * 1000);
      scheduleNextEvent();
    }
    function cancelNextEvent() {
      clearTimeout(eventTimeoutId);
      eventTimeoutId = null;
    }
    function executeEvent(event) {
      const [time, type, data] = event;
      if (type === "o") {
        feed(data);
      } else if (type === "i") {
        onInput(data);
      } else if (type === "m") {
        onMarker(data);
        if (pauseOnMarkers) {
          pause();
          pauseElapsedTime = time * 1000;
          setState("idle", {
            reason: "paused"
          });
          return true;
        }
      }
      return false;
    }
    function onEnd() {
      cancelNextEvent();
      playCount++;
      if (loop === true || typeof loop === "number" && playCount < loop) {
        nextEventIndex = 0;
        startTime = now();
        feed("\x1bc"); // reset terminal
        resizeTerminalToInitialSize();
        scheduleNextEvent();
      } else {
        pauseElapsedTime = duration * 1000;
        setState("ended");
      }
    }
    function play() {
      if (eventTimeoutId) throw "already playing";
      if (events[nextEventIndex] === undefined) throw "already ended";
      if (effectiveStartAt !== null) {
        seek(effectiveStartAt);
      }
      resume();
      return true;
    }
    function pause() {
      if (!eventTimeoutId) return true;
      cancelNextEvent();
      pauseElapsedTime = now() - startTime;
      return true;
    }
    function resume() {
      startTime = now() - pauseElapsedTime;
      pauseElapsedTime = null;
      scheduleNextEvent();
    }
    function seek(where) {
      const isPlaying = !!eventTimeoutId;
      pause();
      const currentTime = (pauseElapsedTime ?? 0) / 1000;
      if (typeof where === "string") {
        if (where === "<<") {
          where = currentTime - 5;
        } else if (where === ">>") {
          where = currentTime + 5;
        } else if (where === "<<<") {
          where = currentTime - 0.1 * duration;
        } else if (where === ">>>") {
          where = currentTime + 0.1 * duration;
        } else if (where[where.length - 1] === "%") {
          where = parseFloat(where.substring(0, where.length - 1)) / 100 * duration;
        }
      } else if (typeof where === "object") {
        if (where.marker === "prev") {
          where = findMarkerTimeBefore(currentTime) ?? 0;
          if (isPlaying && currentTime - where < 1) {
            where = findMarkerTimeBefore(where) ?? 0;
          }
        } else if (where.marker === "next") {
          where = findMarkerTimeAfter(currentTime) ?? duration;
        } else if (typeof where.marker === "number") {
          const marker = markers[where.marker];
          if (marker === undefined) {
            throw `invalid marker index: ${where.marker}`;
          } else {
            where = marker[0];
          }
        }
      }
      const targetTime = Math.min(Math.max(where, 0), duration);
      if (targetTime < lastEventTime) {
        feed("\x1bc"); // reset terminal
        resizeTerminalToInitialSize();
        nextEventIndex = 0;
        lastEventTime = 0;
      }
      let event = events[nextEventIndex];
      while (event && event[0] <= targetTime) {
        if (event[1] === "o") {
          executeEvent(event);
        }
        lastEventTime = event[0];
        event = events[++nextEventIndex];
      }
      pauseElapsedTime = targetTime * 1000;
      effectiveStartAt = null;
      if (isPlaying) {
        resume();
      }
      return true;
    }
    function findMarkerTimeBefore(time) {
      if (markers.length == 0) return;
      let i = 0;
      let marker = markers[i];
      let lastMarkerTimeBefore;
      while (marker && marker[0] < time) {
        lastMarkerTimeBefore = marker[0];
        marker = markers[++i];
      }
      return lastMarkerTimeBefore;
    }
    function findMarkerTimeAfter(time) {
      if (markers.length == 0) return;
      let i = markers.length - 1;
      let marker = markers[i];
      let firstMarkerTimeAfter;
      while (marker && marker[0] > time) {
        firstMarkerTimeAfter = marker[0];
        marker = markers[--i];
      }
      return firstMarkerTimeAfter;
    }
    function step() {
      let nextEvent = events[nextEventIndex++];
      while (nextEvent !== undefined && nextEvent[1] !== "o") {
        nextEvent = events[nextEventIndex++];
      }
      if (nextEvent === undefined) return;
      feed(nextEvent[2]);
      const targetTime = nextEvent[0];
      lastEventTime = targetTime;
      pauseElapsedTime = targetTime * 1000;
      effectiveStartAt = null;
    }
    function restart() {
      if (eventTimeoutId) throw "still playing";
      if (events[nextEventIndex] !== undefined) throw "not ended";
      seek(0);
      resume();
      return true;
    }
    function getPoster(time) {
      return events.filter(e => e[0] < time && e[1] === "o").map(e => e[2]);
    }
    function getCurrentTime() {
      if (eventTimeoutId) {
        return (now() - startTime) / 1000;
      } else {
        return (pauseElapsedTime ?? 0) / 1000;
      }
    }
    function resizeTerminalToInitialSize() {
      feed(`\x1b[8;${initialRows};${initialCols};t`);
    }
    return {
      init,
      play,
      pause,
      seek,
      step,
      restart,
      stop: pause,
      getCurrentTime
    };
  }
  function batcher(logger) {
    let minFrameTime = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 1.0 / 60;
    let prevEvent;
    return emit => {
      let ic = 0;
      let oc = 0;
      return {
        step: event => {
          ic++;
          if (prevEvent === undefined) {
            prevEvent = event;
            return;
          }
          if (event[1] === prevEvent[1] && event[0] - prevEvent[0] < minFrameTime) {
            if (event[1] === "m" && event[2] !== "") {
              prevEvent[2] = event[2];
            } else {
              prevEvent[2] += event[2];
            }
          } else {
            emit(prevEvent);
            prevEvent = event;
            oc++;
          }
        },
        flush: () => {
          if (prevEvent !== undefined) {
            emit(prevEvent);
            oc++;
          }
          logger.debug(`batched ${ic} frames to ${oc} frames`);
        }
      };
    };
  }
  function prepare(recording, logger, _ref4) {
    let {
      startAt = 0,
      idleTimeLimit,
      minFrameTime,
      inputOffset,
      markers_
    } = _ref4;
    let {
      events
    } = recording;
    if (events === undefined) {
      events = buildEvents(recording);
    }
    if (!(events instanceof Stream)) {
      events = new Stream(events);
    }
    idleTimeLimit = idleTimeLimit ?? recording.idleTimeLimit ?? Infinity;
    const limiterOutput = {
      offset: 0
    };
    events = events.map(convertResizeEvent).transform(batcher(logger, minFrameTime)).map(timeLimiter(idleTimeLimit, startAt, limiterOutput)).map(markerWrapper());
    if (markers_ !== undefined) {
      markers_ = new Stream(markers_).map(normalizeMarker);
      events = events.filter(e => e[1] !== "m").multiplex(markers_, (a, b) => a[0] < b[0]).map(markerWrapper());
    }
    events = events.toArray();
    if (inputOffset !== undefined) {
      events = events.map(e => e[1] === "i" ? [e[0] + inputOffset, e[1], e[2]] : e);
      events.sort((a, b) => a[0] - b[0]);
    }
    const duration = events[events.length - 1][0];
    const effectiveStartAt = startAt - limiterOutput.offset;
    return {
      ...recording,
      events,
      duration,
      effectiveStartAt
    };
  }
  function buildEvents(_ref5) {
    let {
      output = [],
      input = [],
      markers = []
    } = _ref5;
    const o = new Stream(output).map(e => [e[0], "o", e[1]]);
    const i = new Stream(input).map(e => [e[0], "i", e[1]]);
    const m = new Stream(markers).map(normalizeMarker);
    return o.multiplex(i, (a, b) => a[0] < b[0]).multiplex(m, (a, b) => a[0] < b[0]);
  }
  function convertResizeEvent(e) {
    if (e[1] === "r") {
      const [cols, rows] = e[2].split("x");
      return [e[0], "o", `\x1b[8;${rows};${cols};t`];
    } else {
      return e;
    }
  }
  function normalizeMarker(m) {
    return typeof m === "number" ? [m, "m", ""] : [m[0], "m", m[1]];
  }
  function timeLimiter(idleTimeLimit, startAt, output) {
    let prevT = 0;
    let shift = 0;
    return function (e) {
      const delay = e[0] - prevT;
      const delta = delay - idleTimeLimit;
      prevT = e[0];
      if (delta > 0) {
        shift += delta;
        if (e[0] < startAt) {
          output.offset += delta;
        }
      }
      return [e[0] - shift, e[1], e[2]];
    };
  }
  function markerWrapper() {
    let i = 0;
    return function (e) {
      if (e[1] === "m") {
        return [e[0], e[1], {
          index: i++,
          time: e[0],
          label: e[2]
        }];
      } else {
        return e;
      }
    };
  }
  function dump(recording, filename) {
    const link = document.createElement("a");
    const events = recording.events.map(e => e[1] === "m" ? [e[0], e[1], e[2].label] : e);
    const asciicast = unparseAsciicastV2({
      ...recording,
      events
    });
    link.href = URL.createObjectURL(new Blob([asciicast], {
      type: "text/plain"
    }));
    link.download = filename;
    link.click();
  }

  function clock(_ref, _ref2, _ref3) {
    let {
      hourColor = 3,
      minuteColor = 4,
      separatorColor = 9
    } = _ref;
    let {
      feed
    } = _ref2;
    let {
      cols = 5,
      rows = 1
    } = _ref3;
    const middleRow = Math.floor(rows / 2);
    const leftPad = Math.floor(cols / 2) - 2;
    const setupCursor = `\x1b[?25l\x1b[1m\x1b[${middleRow}B`;
    let intervalId;
    const getCurrentTime = () => {
      const d = new Date();
      const h = d.getHours();
      const m = d.getMinutes();
      const seqs = [];
      seqs.push("\r");
      for (let i = 0; i < leftPad; i++) {
        seqs.push(" ");
      }
      seqs.push(`\x1b[3${hourColor}m`);
      if (h < 10) {
        seqs.push("0");
      }
      seqs.push(`${h}`);
      seqs.push(`\x1b[3${separatorColor};5m:\x1b[25m`);
      seqs.push(`\x1b[3${minuteColor}m`);
      if (m < 10) {
        seqs.push("0");
      }
      seqs.push(`${m}`);
      return seqs;
    };
    const updateTime = () => {
      getCurrentTime().forEach(feed);
    };
    return {
      init: () => {
        const duration = 24 * 60;
        const poster = [setupCursor].concat(getCurrentTime());
        return {
          cols,
          rows,
          duration,
          poster
        };
      },
      play: () => {
        feed(setupCursor);
        updateTime();
        intervalId = setInterval(updateTime, 1000);
        return true;
      },
      stop: () => {
        clearInterval(intervalId);
      },
      getCurrentTime: () => {
        const d = new Date();
        return d.getHours() * 60 + d.getMinutes();
      }
    };
  }

  function random(src, _ref) {
    let {
      feed,
      setTimeout
    } = _ref;
    const base = " ".charCodeAt(0);
    const range = "~".charCodeAt(0) - base;
    let timeoutId;
    const schedule = () => {
      const t = Math.pow(5, Math.random() * 4);
      timeoutId = setTimeout(print, t);
    };
    const print = () => {
      schedule();
      const char = String.fromCharCode(base + Math.floor(Math.random() * range));
      feed(char);
    };
    return () => {
      schedule();
      return () => clearInterval(timeoutId);
    };
  }

  function benchmark(_ref, _ref2) {
    let {
      url,
      iterations = 10
    } = _ref;
    let {
      feed,
      setState,
      now
    } = _ref2;
    let data;
    let byteCount = 0;
    return {
      async init() {
        const recording = await parse$2(await fetch(url));
        const {
          cols,
          rows,
          events
        } = recording;
        data = Array.from(events).filter(_ref3 => {
          let [_time, type, _text] = _ref3;
          return type === "o";
        }).map(_ref4 => {
          let [time, _type, text] = _ref4;
          return [time, text];
        });
        const duration = data[data.length - 1][0];
        for (const [_, text] of data) {
          byteCount += new Blob([text]).size;
        }
        return {
          cols,
          rows,
          duration
        };
      },
      play() {
        const startTime = now();
        for (let i = 0; i < iterations; i++) {
          for (const [_, text] of data) {
            feed(text);
          }
          feed("\x1bc"); // reset terminal
        }

        const endTime = now();
        const duration = (endTime - startTime) / 1000;
        const throughput = byteCount * iterations / duration;
        const throughputMbs = byteCount / (1024 * 1024) * iterations / duration;
        console.info("benchmark: result", {
          byteCount,
          iterations,
          duration,
          throughput,
          throughputMbs
        });
        setTimeout(() => {
          setState("stopped", {
            reason: "ended"
          });
        }, 0);
        return true;
      }
    };
  }

  class Queue {
    constructor() {
      this.items = [];
      this.onPush = undefined;
    }
    push(item) {
      this.items.push(item);
      if (this.onPush !== undefined) {
        this.onPush(this.popAll());
        this.onPush = undefined;
      }
    }
    popAll() {
      if (this.items.length > 0) {
        const items = this.items;
        this.items = [];
        return items;
      } else {
        const thiz = this;
        return new Promise(resolve => {
          thiz.onPush = resolve;
        });
      }
    }
  }

  function getBuffer(bufferTime, feed, setTime, baseStreamTime, minFrameTime, logger) {
    if (bufferTime === 0) {
      logger.debug("using no buffer");
      return nullBuffer(feed);
    } else {
      bufferTime = bufferTime ?? {};
      let getBufferTime;
      if (typeof bufferTime === "number") {
        logger.debug(`using fixed time buffer (${bufferTime} ms)`);
        getBufferTime = _latency => bufferTime;
      } else if (typeof bufferTime === "function") {
        logger.debug("using custom dynamic buffer");
        getBufferTime = bufferTime({
          logger
        });
      } else {
        logger.debug("using adaptive buffer", bufferTime);
        getBufferTime = adaptiveBufferTimeProvider({
          logger
        }, bufferTime);
      }
      return buffer(getBufferTime, feed, setTime, logger, baseStreamTime ?? 0.0, minFrameTime);
    }
  }
  function nullBuffer(feed) {
    return {
      pushEvent(event) {
        if (event[1] === "o") {
          feed(event[2]);
        } else if (event[1] === "r") {
          const [cols, rows] = event[2].split("x");
          feed(`\x1b[8;${rows};${cols};t`);
        }
      },
      pushText(text) {
        feed(text);
      },
      stop() {}
    };
  }
  function buffer(getBufferTime, feed, setTime, logger, baseStreamTime) {
    let minFrameTime = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : 1.0 / 60;
    let epoch = performance.now() - baseStreamTime * 1000;
    let bufferTime = getBufferTime(0);
    const queue = new Queue();
    minFrameTime *= 1000;
    let prevElapsedStreamTime = -minFrameTime;
    let stop = false;
    function elapsedWallTime() {
      return performance.now() - epoch;
    }
    setTimeout(async () => {
      while (!stop) {
        const events = await queue.popAll();
        if (stop) return;
        for (const event of events) {
          const elapsedStreamTime = event[0] * 1000 + bufferTime;
          if (elapsedStreamTime - prevElapsedStreamTime < minFrameTime) {
            feed(event[2]);
            continue;
          }
          const delay = elapsedStreamTime - elapsedWallTime();
          if (delay > 0) {
            await sleep(delay);
            if (stop) return;
          }
          setTime(event[0]);
          feed(event[2]);
          prevElapsedStreamTime = elapsedStreamTime;
        }
      }
    }, 0);
    return {
      pushEvent(event) {
        let latency = elapsedWallTime() - event[0] * 1000;
        if (latency < 0) {
          logger.debug(`correcting epoch by ${latency} ms`);
          epoch += latency;
          latency = 0;
        }
        bufferTime = getBufferTime(latency);
        if (event[1] === "o") {
          queue.push(event);
        } else if (event[1] === "r") {
          const [cols, rows] = event[2].split("x");
          queue.push([event[0], "o", `\x1b[8;${rows};${cols};t`]);
        }
      },
      pushText(text) {
        queue.push([elapsedWallTime(), "o", text]);
      },
      stop() {
        stop = true;
        queue.push(undefined);
      }
    };
  }
  function sleep(t) {
    return new Promise(resolve => {
      setTimeout(resolve, t);
    });
  }
  function adaptiveBufferTimeProvider(_ref, _ref2) {
    let {
      logger
    } = _ref;
    let {
      minTime = 25,
      maxLevel = 100,
      interval = 50,
      windowSize = 20,
      smoothingFactor = 0.2,
      minImprovementDuration = 1000
    } = _ref2;
    let bufferLevel = 0;
    let bufferTime = calcBufferTime(bufferLevel);
    let latencies = [];
    let maxJitter = 0;
    let jitterRange = 0;
    let improvementTs = null;
    function calcBufferTime(level) {
      if (level === 0) {
        return minTime;
      } else {
        return interval * level;
      }
    }
    return latency => {
      latencies.push(latency);
      if (latencies.length < windowSize) {
        return bufferTime;
      }
      latencies = latencies.slice(-windowSize);
      const currentMinJitter = min(latencies);
      const currentMaxJitter = max(latencies);
      const currentJitterRange = currentMaxJitter - currentMinJitter;
      maxJitter = currentMaxJitter * smoothingFactor + maxJitter * (1 - smoothingFactor);
      jitterRange = currentJitterRange * smoothingFactor + jitterRange * (1 - smoothingFactor);
      const minBufferTime = maxJitter + jitterRange;
      if (latency > bufferTime) {
        logger.debug('buffer underrun', {
          latency,
          maxJitter,
          jitterRange,
          bufferTime
        });
      }
      if (bufferLevel < maxLevel && minBufferTime > bufferTime) {
        bufferTime = calcBufferTime(bufferLevel += 1);
        logger.debug(`jitter increased, raising bufferTime`, {
          latency,
          maxJitter,
          jitterRange,
          bufferTime
        });
      } else if (bufferLevel > 1 && minBufferTime < calcBufferTime(bufferLevel - 2) || bufferLevel == 1 && minBufferTime < calcBufferTime(bufferLevel - 1)) {
        if (improvementTs === null) {
          improvementTs = performance.now();
        } else if (performance.now() - improvementTs > minImprovementDuration) {
          improvementTs = performance.now();
          bufferTime = calcBufferTime(bufferLevel -= 1);
          logger.debug(`jitter decreased, lowering bufferTime`, {
            latency,
            maxJitter,
            jitterRange,
            bufferTime
          });
        }
        return bufferTime;
      }
      improvementTs = null;
      return bufferTime;
    };
  }
  function min(numbers) {
    return numbers.reduce((prev, cur) => cur < prev ? cur : prev);
  }
  function max(numbers) {
    return numbers.reduce((prev, cur) => cur > prev ? cur : prev);
  }

  function exponentialDelay(attempt) {
    return Math.min(500 * Math.pow(2, attempt), 5000);
  }
  function websocket(_ref, _ref2) {
    let {
      url,
      bufferTime,
      reconnectDelay = exponentialDelay,
      minFrameTime
    } = _ref;
    let {
      feed,
      reset,
      setState,
      logger
    } = _ref2;
    logger = new PrefixedLogger(logger, "websocket: ");
    const utfDecoder = new TextDecoder();
    let socket;
    let buf;
    let clock = new NullClock();
    let reconnectAttempt = 0;
    let successfulConnectionTimeout;
    let stop = false;
    let wasOnline = false;
    function initBuffer(baseStreamTime) {
      if (buf !== undefined) buf.stop();
      buf = getBuffer(bufferTime, feed, t => clock.setTime(t), baseStreamTime, minFrameTime, logger);
    }
    function detectProtocol(event) {
      if (typeof event.data === "string") {
        logger.info("activating asciicast-compatible handler");
        initBuffer();
        socket.onmessage = handleJsonMessage;
        handleJsonMessage(event);
      } else {
        const arr = new Uint8Array(event.data);
        if (arr[0] == 0x41 && arr[1] == 0x4c && arr[2] == 0x69 && arr[3] == 0x53) {
          // 'ALiS'
          if (arr[4] == 1) {
            logger.info("activating ALiS v1 handler");
            socket.onmessage = handleStreamMessage;
          } else {
            logger.warn(`unsupported ALiS version (${arr[4]})`);
            socket.close();
          }
        } else {
          logger.info("activating raw text handler");
          initBuffer();
          const text = utfDecoder.decode(arr);
          const size = sizeFromResizeSeq(text) ?? sizeFromScriptStartMessage(text);
          if (size !== undefined) {
            const [cols, rows] = size;
            handleResetMessage(cols, rows, 0, undefined);
          }
          socket.onmessage = handleRawTextMessage;
          handleRawTextMessage(event);
        }
      }
    }
    function sizeFromResizeSeq(text) {
      const match = text.match(/\x1b\[8;(\d+);(\d+)t/);
      if (match !== null) {
        return [parseInt(match[2], 10), parseInt(match[1], 10)];
      }
    }
    function sizeFromScriptStartMessage(text) {
      const match = text.match(/\[.*COLUMNS="(\d{1,3})" LINES="(\d{1,3})".*\]/);
      if (match !== null) {
        return [parseInt(match[1], 10), parseInt(match[2], 10)];
      }
    }
    function handleJsonMessage(event) {
      const e = JSON.parse(event.data);
      if (Array.isArray(e)) {
        buf.pushEvent(e);
      } else if (e.cols !== undefined || e.width !== undefined) {
        handleResetMessage(e.cols ?? e.width, e.rows ?? e.height, e.time, e.init ?? undefined);
      } else if (e.status === "offline") {
        handleOfflineMessage();
      }
    }
    const THEME_LEN = 54; // (2 + 16) * 3

    function handleStreamMessage(event) {
      const buffer = event.data;
      const view = new DataView(buffer);
      const type = view.getUint8(0);
      let offset = 1;
      if (type === 0x01) {
        // reset
        const cols = view.getUint16(offset, true);
        offset += 2;
        const rows = view.getUint16(offset, true);
        offset += 2;
        const time = view.getFloat32(offset, true);
        offset += 4;
        const themeFormat = view.getUint8(offset);
        offset += 1;
        let theme;
        if (themeFormat === 1) {
          theme = parseTheme(new Uint8Array(buffer, offset, THEME_LEN));
          offset += THEME_LEN;
        }
        const initLen = view.getUint32(offset, true);
        offset += 4;
        let init;
        if (initLen > 0) {
          init = utfDecoder.decode(new Uint8Array(buffer, offset, initLen));
          offset += initLen;
        }
        handleResetMessage(cols, rows, time, init, theme);
      } else if (type === 0x6f) {
        // 'o' - output
        const time = view.getFloat32(1, true);
        const len = view.getUint32(5, true);
        const text = utfDecoder.decode(new Uint8Array(buffer, 9, len));
        buf.pushEvent([time, "o", text]);
      } else if (type === 0x72) {
        // 'r' - resize
        const time = view.getFloat32(1, true);
        const cols = view.getUint16(5, true);
        const rows = view.getUint16(7, true);
        buf.pushEvent([time, "r", `${cols}x${rows}`]);
      } else if (type === 0x04) {
        // offline (EOT)
        handleOfflineMessage();
      } else {
        logger.debug(`unknown frame type: ${type}`);
      }
    }
    function parseTheme(arr) {
      const foreground = hexColor(arr[0], arr[1], arr[2]);
      const background = hexColor(arr[3], arr[4], arr[5]);
      const palette = [];
      for (let i = 0; i < 16; i++) {
        palette.push(hexColor(arr[i * 3 + 6], arr[i * 3 + 7], arr[i * 3 + 8]));
      }
      return {
        foreground,
        background,
        palette
      };
    }
    function hexColor(r, g, b) {
      return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
    }
    function byteToHex(value) {
      return value.toString(16).padStart(2, "0");
    }
    function handleRawTextMessage(event) {
      buf.pushText(utfDecoder.decode(event.data));
    }
    function handleResetMessage(cols, rows, time, init, theme) {
      logger.debug(`stream reset (${cols}x${rows} @${time})`);
      setState("playing");
      initBuffer(time);
      reset(cols, rows, init, theme);
      clock = new Clock();
      wasOnline = true;
      if (typeof time === "number") {
        clock.setTime(time);
      }
    }
    function handleOfflineMessage() {
      logger.info("stream offline");
      if (wasOnline) {
        setState("offline", {
          message: "Stream ended"
        });
      } else {
        setState("offline", {
          message: "Stream offline"
        });
      }
      clock = new NullClock();
    }
    function connect() {
      socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        logger.info("opened");
        successfulConnectionTimeout = setTimeout(() => {
          reconnectAttempt = 0;
        }, 1000);
      };
      socket.onmessage = detectProtocol;
      socket.onclose = event => {
        if (stop || event.code === 1000 || event.code === 1005) {
          logger.info("closed");
          setState("ended", {
            message: "Stream ended"
          });
        } else {
          clearTimeout(successfulConnectionTimeout);
          const delay = reconnectDelay(reconnectAttempt++);
          logger.info(`unclean close, reconnecting in ${delay}...`);
          setState("loading");
          setTimeout(connect, delay);
        }
      };
      wasOnline = false;
    }
    return {
      play: () => {
        connect();
      },
      stop: () => {
        stop = true;
        if (buf !== undefined) buf.stop();
        if (socket !== undefined) socket.close();
      },
      getCurrentTime: () => clock.getTime()
    };
  }

  function eventsource(_ref, _ref2) {
    let {
      url,
      bufferTime,
      minFrameTime
    } = _ref;
    let {
      feed,
      reset,
      setState,
      logger
    } = _ref2;
    logger = new PrefixedLogger(logger, "eventsource: ");
    let es;
    let buf;
    let clock = new NullClock();
    function initBuffer(baseStreamTime) {
      if (buf !== undefined) buf.stop();
      buf = getBuffer(bufferTime, feed, t => clock.setTime(t), baseStreamTime, minFrameTime, logger);
    }
    return {
      play: () => {
        es = new EventSource(url);
        es.addEventListener("open", () => {
          logger.info("opened");
          initBuffer();
        });
        es.addEventListener("error", e => {
          logger.info("errored");
          logger.debug({
            e
          });
          setState("loading");
        });
        es.addEventListener("message", event => {
          const e = JSON.parse(event.data);
          if (Array.isArray(e)) {
            buf.pushEvent(e);
          } else if (e.cols !== undefined || e.width !== undefined) {
            const cols = e.cols ?? e.width;
            const rows = e.rows ?? e.height;
            logger.debug(`vt reset (${cols}x${rows})`);
            setState("playing");
            initBuffer(e.time);
            reset(cols, rows, e.init ?? undefined);
            clock = new Clock();
            if (typeof e.time === "number") {
              clock.setTime(e.time);
            }
          } else if (e.state === "offline") {
            logger.info("stream offline");
            setState("offline", {
              message: "Stream offline"
            });
            clock = new NullClock();
          }
        });
        es.addEventListener("done", () => {
          logger.info("closed");
          es.close();
          setState("ended", {
            message: "Stream ended"
          });
        });
      },
      stop: () => {
        if (buf !== undefined) buf.stop();
        if (es !== undefined) es.close();
      },
      getCurrentTime: () => clock.getTime()
    };
  }

  async function parse$1(responses, _ref) {
    let {
      encoding
    } = _ref;
    const textDecoder = new TextDecoder(encoding);
    let cols;
    let rows;
    let timing = (await responses[0].text()).split("\n").filter(line => line.length > 0).map(line => line.split(" "));
    if (timing[0].length < 3) {
      timing = timing.map(entry => ["O", entry[0], entry[1]]);
    }
    const buffer = await responses[1].arrayBuffer();
    const array = new Uint8Array(buffer);
    const dataOffset = array.findIndex(byte => byte == 0x0a) + 1;
    const header = textDecoder.decode(array.subarray(0, dataOffset));
    const sizeMatch = header.match(/COLUMNS="(\d+)" LINES="(\d+)"/);
    if (sizeMatch !== null) {
      cols = parseInt(sizeMatch[1], 10);
      rows = parseInt(sizeMatch[2], 10);
    }
    const stdout = {
      array,
      cursor: dataOffset
    };
    let stdin = stdout;
    if (responses[2] !== undefined) {
      const buffer = await responses[2].arrayBuffer();
      const array = new Uint8Array(buffer);
      stdin = {
        array,
        cursor: dataOffset
      };
    }
    const events = [];
    let time = 0;
    for (const entry of timing) {
      time += parseFloat(entry[1]);
      if (entry[0] === "O") {
        const count = parseInt(entry[2], 10);
        const bytes = stdout.array.subarray(stdout.cursor, stdout.cursor + count);
        const text = textDecoder.decode(bytes);
        events.push([time, "o", text]);
        stdout.cursor += count;
      } else if (entry[0] === "I") {
        const count = parseInt(entry[2], 10);
        const bytes = stdin.array.subarray(stdin.cursor, stdin.cursor + count);
        const text = textDecoder.decode(bytes);
        events.push([time, "i", text]);
        stdin.cursor += count;
      } else if (entry[0] === "S" && entry[2] === "SIGWINCH") {
        const cols = parseInt(entry[4].slice(5), 10);
        const rows = parseInt(entry[3].slice(5), 10);
        events.push([time, "r", `${cols}x${rows}`]);
      } else if (entry[0] === "H" && entry[2] === "COLUMNS") {
        cols = parseInt(entry[3], 10);
      } else if (entry[0] === "H" && entry[2] === "LINES") {
        rows = parseInt(entry[3], 10);
      }
    }
    cols = cols ?? 80;
    rows = rows ?? 24;
    return {
      cols,
      rows,
      events
    };
  }

  async function parse(response, _ref) {
    let {
      encoding
    } = _ref;
    const textDecoder = new TextDecoder(encoding);
    const buffer = await response.arrayBuffer();
    const array = new Uint8Array(buffer);
    const firstFrame = parseFrame(array);
    const baseTime = firstFrame.time;
    const firstFrameText = textDecoder.decode(firstFrame.data);
    const sizeMatch = firstFrameText.match(/\x1b\[8;(\d+);(\d+)t/);
    const events = [];
    let cols = 80;
    let rows = 24;
    if (sizeMatch !== null) {
      cols = parseInt(sizeMatch[2], 10);
      rows = parseInt(sizeMatch[1], 10);
    }
    let cursor = 0;
    let frame = parseFrame(array);
    while (frame !== undefined) {
      const time = frame.time - baseTime;
      const text = textDecoder.decode(frame.data);
      events.push([time, "o", text]);
      cursor += frame.len;
      frame = parseFrame(array.subarray(cursor));
    }
    return {
      cols,
      rows,
      events
    };
  }
  function parseFrame(array) {
    if (array.length < 13) return;
    const time = parseTimestamp(array.subarray(0, 8));
    const len = parseNumber(array.subarray(8, 12));
    const data = array.subarray(12, 12 + len);
    return {
      time,
      data,
      len: len + 12
    };
  }
  function parseNumber(array) {
    return array[0] + array[1] * 256 + array[2] * 256 * 256 + array[3] * 256 * 256 * 256;
  }
  function parseTimestamp(array) {
    const sec = parseNumber(array.subarray(0, 4));
    const usec = parseNumber(array.subarray(4, 8));
    return sec + usec / 1000000;
  }

  const drivers = new Map([["benchmark", benchmark], ["clock", clock], ["eventsource", eventsource], ["random", random], ["recording", recording], ["websocket", websocket]]);
  const parsers = new Map([["asciicast", parse$2], ["typescript", parse$1], ["ttyrec", parse]]);
  function create(src, elem) {
    let opts = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
    const logger = opts.logger ?? new DummyLogger();
    const core = new Core(getDriver(src), {
      logger: logger,
      cols: opts.cols,
      rows: opts.rows,
      loop: opts.loop,
      speed: opts.speed,
      preload: opts.preload,
      startAt: opts.startAt,
      poster: opts.poster,
      markers: opts.markers,
      pauseOnMarkers: opts.pauseOnMarkers,
      idleTimeLimit: opts.idleTimeLimit
    });
    const metrics = measureTerminal(opts.terminalFontFamily, opts.terminalLineHeight);
    const props = {
      logger: logger,
      core: core,
      cols: opts.cols,
      rows: opts.rows,
      fit: opts.fit,
      controls: opts.controls ?? "auto",
      autoPlay: opts.autoPlay ?? opts.autoplay,
      terminalFontSize: opts.terminalFontSize,
      terminalFontFamily: opts.terminalFontFamily,
      terminalLineHeight: opts.terminalLineHeight,
      theme: opts.theme,
      ...metrics
    };
    let el;
    const dispose = render(() => {
      el = createComponent(Player, props);
      return el;
    }, elem);
    const player = {
      el: el,
      dispose: dispose,
      getCurrentTime: () => core.getCurrentTime(),
      getDuration: () => core.getDuration(),
      play: () => core.play(),
      pause: () => core.pause(),
      seek: pos => core.seek(pos)
    };
    player.addEventListener = (name, callback) => {
      return core.addEventListener(name, callback.bind(player));
    };
    return player;
  }
  function getDriver(src) {
    if (typeof src === "function") return src;
    if (typeof src === "string") {
      if (src.substring(0, 5) == "ws://" || src.substring(0, 6) == "wss://") {
        src = {
          driver: "websocket",
          url: src
        };
      } else if (src.substring(0, 6) == "clock:") {
        src = {
          driver: "clock"
        };
      } else if (src.substring(0, 7) == "random:") {
        src = {
          driver: "random"
        };
      } else if (src.substring(0, 10) == "benchmark:") {
        src = {
          driver: "benchmark",
          url: src.substring(10)
        };
      } else {
        src = {
          driver: "recording",
          url: src
        };
      }
    }
    if (src.driver === undefined) {
      src.driver = "recording";
    }
    if (src.driver == "recording") {
      if (src.parser === undefined) {
        src.parser = "asciicast";
      }
      if (typeof src.parser === "string") {
        if (parsers.has(src.parser)) {
          src.parser = parsers.get(src.parser);
        } else {
          throw `unknown parser: ${src.parser}`;
        }
      }
    }
    if (drivers.has(src.driver)) {
      const driver = drivers.get(src.driver);
      return (callbacks, opts) => driver(src, callbacks, opts);
    } else {
      throw `unsupported driver: ${JSON.stringify(src)}`;
    }
  }
  function measureTerminal(fontFamily, lineHeight) {
    const cols = 80;
    const rows = 24;
    const div = document.createElement("div");
    div.style.height = "0px";
    div.style.overflow = "hidden";
    div.style.fontSize = "15px"; // must match font-size of div.asciinema-player in CSS
    document.body.appendChild(div);
    let el;
    const dispose = render(() => {
      el = createComponent(Terminal, {
        cols: cols,
        rows: rows,
        lineHeight: lineHeight,
        fontFamily: fontFamily,
        lines: []
      });
      return el;
    }, div);
    const metrics = {
      charW: el.clientWidth / cols,
      charH: el.clientHeight / rows,
      bordersW: el.offsetWidth - el.clientWidth,
      bordersH: el.offsetHeight - el.clientHeight
    };
    dispose();
    document.body.removeChild(div);
    return metrics;
  }

  exports.create = create;

  return exports;

})({});
