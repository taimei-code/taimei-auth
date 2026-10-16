import { createClient, type Transport } from "@connectrpc/connect";
import { TestingService } from "./gen/auth/testing/v1/testing_pb";

export const TESTING_RPC_PATH = "/testing/rpc";

export const createTestingRpcClient = (transport: Transport) => createClient(TestingService, transport);
