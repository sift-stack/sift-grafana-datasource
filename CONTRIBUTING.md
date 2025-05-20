# Contribution Guide

### Prerequisites

- Node.js (20)
- Go (for backend development)
- Docker (for local testing)

### Setup

1. Set up git hooks:

```bash
git config core.hooksPath .githooks
```

2. Install dependencies:

```bash
npm install
```

3. Build backend plugin binaries:

```bash
mage -v
```

### Development Workflow

1. Build plugin in development mode:

```bash
npm run dev
```

2. Run tests:

```bash
# Frontend tests
# Watch mode for development
npm run test

# CI mode
npm run test:ci

# Backend tests
npm run test:go
# or
mage test
# or
go test ./pkg/plugin/... -v
```

3. Run linter:

```bash
# Frontend linter
npm run lint
# or
npm run lint:fix

# Backend linter
mage lint
# or
golangci-lint run
```

4. Local testing with Grafana:

```bash
npm run server
```

or with hot-reloading of backend plugin changes:

```bash
npm run server:watch
```

5. Run E2E tests:

```bash
npm run server
npm run e2e
```

## Contributing

### Creating Issues

1. Search existing issues to avoid duplicates
2. Use a clear, descriptive title
3. Include steps to reproduce if reporting a bug
4. Provide context and examples for feature requests

### Creating Pull Requests

1. Create a feature branch from main
2. Make focused, atomic commits with clear messages
3. Run tests and linting locally
4. Add or update unit tests for new functionality
5. Ensure all existing tests pass
6. Update documentation if needed
7. Submit PR with description of changes, and add a reviewer from the Sift team
8. Respond to review feedback

## License

Apache-2.0
