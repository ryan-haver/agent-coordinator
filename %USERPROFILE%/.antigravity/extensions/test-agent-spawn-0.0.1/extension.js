const vscode = require('vscode');

/** @param {vscode.ExtensionContext} context */
function activate(context) {
    const log = vscode.window.createOutputChannel('Agent Spawn Test');
    log.show(true);
    log.appendLine('✅ Test Agent Spawn extension activated');

    // ── Test 1: List all geminicodeassist commands ──
    context.subscriptions.push(
        vscode.commands.registerCommand('testAgentSpawn.listCommands', async () => {
            log.appendLine('\n═══ Listing Gemini Commands ═══');
            const allCommands = await vscode.commands.getCommands(true);
            const geminiCmds = allCommands.filter(c =>
                c.includes('gemini') || c.includes('codeassist') || c.includes('agent')
            );
            geminiCmds.sort();
            log.appendLine(`Found ${geminiCmds.length} matching commands:`);
            for (const cmd of geminiCmds) {
                log.appendLine(`  • ${cmd}`);
            }
            log.appendLine('═══════════════════════════════');
        })
    );

    // ── Test 2: Try geminicodeassist.startagent with various arg shapes ──
    context.subscriptions.push(
        vscode.commands.registerCommand('testAgentSpawn.startAgent', async () => {
            log.appendLine('\n═══ Testing startagent ═══');

            // Attempt 1: No args
            try {
                log.appendLine('→ Attempt 1: No args');
                const result = await vscode.commands.executeCommand('geminicodeassist.startagent');
                log.appendLine(`  Result: ${JSON.stringify(result)}`);
            } catch (e) {
                log.appendLine(`  Error: ${e.message}`);
            }

            log.appendLine('═══════════════════════════════');
        })
    );

    // ── Test 3: Try geminicodeassist.chat.new with prompt ──
    context.subscriptions.push(
        vscode.commands.registerCommand('testAgentSpawn.newChat', async () => {
            log.appendLine('\n═══ Testing chat.new ═══');

            // Attempt 1: String arg
            try {
                log.appendLine('→ Attempt 1: String arg');
                const result = await vscode.commands.executeCommand(
                    'geminicodeassist.chat.new',
                    'Hello from test extension!'
                );
                log.appendLine(`  Result: ${JSON.stringify(result)}`);
            } catch (e) {
                log.appendLine(`  Error: ${e.message}`);
            }

            // Attempt 2: Object arg with prompt
            try {
                log.appendLine('→ Attempt 2: Object arg with prompt');
                const result = await vscode.commands.executeCommand(
                    'geminicodeassist.chat.new',
                    { prompt: 'Hello from test extension!' }
                );
                log.appendLine(`  Result: ${JSON.stringify(result)}`);
            } catch (e) {
                log.appendLine(`  Error: ${e.message}`);
            }

            // Attempt 3: Object arg with message
            try {
                log.appendLine('→ Attempt 3: Object arg with message');
                const result = await vscode.commands.executeCommand(
                    'geminicodeassist.chat.new',
                    { message: 'Hello from test extension!' }
                );
                log.appendLine(`  Result: ${JSON.stringify(result)}`);
            } catch (e) {
                log.appendLine(`  Error: ${e.message}`);
            }

            log.appendLine('═══════════════════════════════');
        })
    );

    // ── Test 4: Run all tests sequentially ──
    context.subscriptions.push(
        vscode.commands.registerCommand('testAgentSpawn.run', async () => {
            log.appendLine('\n╔═══════════════════════════════════╗');
            log.appendLine('║   AGENT SPAWN TEST SUITE          ║');
            log.appendLine('╚═══════════════════════════════════╝');

            await vscode.commands.executeCommand('testAgentSpawn.listCommands');

            // Short pause between tests
            await new Promise(r => setTimeout(r, 1000));

            await vscode.commands.executeCommand('testAgentSpawn.startAgent');

            log.appendLine('\n✅ Test suite complete! Review output above.');
        })
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
