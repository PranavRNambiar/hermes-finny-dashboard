// Some MCP clients probe OIDC discovery before RFC 8414; serve the same metadata.
export { GET, OPTIONS, dynamic } from "../oauth-authorization-server/[[...path]]/route";
