import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMailBridgeMcpServer } from "../mcp/server.js";
import type { MailService } from "../services/mailService.js";

export async function startStdioTransport(service: MailService): Promise<void> {
  const server = createMailBridgeMcpServer(service, true);
  await server.connect(new StdioServerTransport());
}
