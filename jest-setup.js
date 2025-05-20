// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';
global.IntersectionObserver = class {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
};
