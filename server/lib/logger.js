const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

export function createLogger({ level = 'info', name = 'dashboard' } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(lvl, message, fields = {}) {
    if ((LEVELS[lvl] ?? LEVELS.info) > threshold) return;
    const entry = {
      ts: new Date().toISOString(),
      level: lvl,
      logger: name,
      msg: message,
      ...fields
    };
    const line = JSON.stringify(entry);
    if (lvl === 'error' || lvl === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }

  return {
    level,
    error: (msg, fields) => write('error', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    debug: (msg, fields) => write('debug', msg, fields),
    child: (fields) => {
      const parent = createLogger({ level, name });
      return {
        ...parent,
        error: (msg, f = {}) => parent.error(msg, { ...fields, ...f }),
        warn: (msg, f = {}) => parent.warn(msg, { ...fields, ...f }),
        info: (msg, f = {}) => parent.info(msg, { ...fields, ...f }),
        debug: (msg, f = {}) => parent.debug(msg, { ...fields, ...f }),
        child: parent.child
      };
    }
  };
}
