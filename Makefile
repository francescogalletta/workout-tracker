.PHONY: dev test build shell install typecheck

dev:
	docker compose up --build

test:
	docker compose run --rm app npm test

typecheck:
	docker compose run --rm app npx tsc --noEmit

build:
	docker compose run --rm app npm run build

shell:
	docker compose run --rm app sh

install:
	docker compose run --rm app npm install
