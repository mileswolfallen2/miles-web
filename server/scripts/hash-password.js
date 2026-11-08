import argon2 from 'argon2';
import { ARGON2_OPTIONS } from '../services/vault.js';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.resume();
  });
}

const supplied = process.argv.slice(2).join(' ').trim();
const password = supplied || process.env.VAULT_PASSWORD || (await readStdin());

if (!password) {
  console.error('Usage: npm run hash-password -- "your passphrase"');
  console.error('   or: printf "your passphrase" | npm run hash-password');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Refusing to hash a passphrase shorter than 8 characters.');
  process.exit(1);
}

const hash = await argon2.hash(password, ARGON2_OPTIONS);

console.log('');
console.log('Add this line to .env on the server:');
console.log('');
console.log(`VAULT_PASSWORD_HASH=${hash}`);
console.log('');
console.log('Keep the passphrase out of shell history, git, and frontend files.');
