This folder contains templates for docs generation with solidity-docgen: https://github.com/OpenZeppelin/solidity-docgen

Two modifications to the default templates:

1. In contract.hbs: Skip elements with visibility internal, see https://github.com/OpenZeppelin/solidity-docgen/issues/414#issuecomment-1367562229
2. In page.hbs: Replace title "Solidity API" from default with the actual filename, see https://github.com/OpenZeppelin/solidity-docgen/issues/421

Note: The output in `/docs` is used in avocado-docs (https://github.com/Instadapp/avocado-docs).
