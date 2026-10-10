export const botCommands = [
 {command:'help',description:'Ajuda e capacidades'},
 {command:'new',description:'Iniciar uma nova conversa'},
 {command:'status',description:'Ver configurações e estado da conversa'}
];

export function commandFor(text,username) {
 const match=/^\/(\w+)(?:@([\w]+))?(?:\s|$)/.exec(text.trim());
 if(!match)return undefined;
 if(match[2]&&(!username||match[2].toLowerCase()!==username.replace(/^@/,'').toLowerCase()))return 'other-bot';
 return match[1].toLowerCase();
}

export function commandReply(command,{sandbox='read-only',webSearch='disabled',historyTurns=6}={}) {
 if(['new','reset'].includes(command))return 'Nova conversa iniciada. O histórico anterior não será usado. Os arquivos da pasta de trabalho continuam disponíveis.';
 if(command==='status')return `Bot Codex ativo.\nArquivos e terminal: ${sandbox==='workspace-write'?'escrita na pasta de trabalho':'somente leitura'}.\nBusca web: ${webSearch}.\nMemória: últimas ${historyTurns} interações desde /new.`;
 if(['help','start'].includes(command))return 'Sou seu assistente Codex no Telegram.\n/help — ajuda\n/new ou /reset — iniciar uma conversa sem o histórico anterior\n/status — configurações da conversa\n\nEnvie uma tarefa em texto. Posso trabalhar com arquivos e terminal na minha pasta de trabalho quando habilitados e pesquisar na web. Os arquivos ficam disponíveis entre mensagens. Recursos de voz, anexos, navegador visual e tarefas agendadas ainda não estão integrados.';
 return 'Comando desconhecido. Use /help para ver os comandos disponíveis.';
}
