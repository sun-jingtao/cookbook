import { Agent } from '@cursor/sdk';

const agent = Agent.create({
  apiKey: process.env.CURSOR_API_KEY,
  name: 'SDK quickstart',
  model: { id: 'composer-2.5' },
  local: { cwd: process.cwd() },
});

const prompt = '用一段话解释这个项目。';
const run = await agent.send(prompt);

for await (const event of run.stream()) {
  if (event.type !== 'assistant') continue;

  for (const block of event.message.content) {
    if (block.type === 'text') {
      process.stdout.write(block.text);
    }
  }
}

await run.wait();