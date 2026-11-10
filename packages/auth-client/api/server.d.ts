import { type Interceptor, type Transport } from "@connectrpc/connect";
type ClientOptions = {
    transport: Transport;
};
export declare function createAuthClient(options: ClientOptions): {
    authService: import("@connectrpc/connect").Client<import("@bufbuild/protobuf/codegenv2").GenService<{
        verifySession: {
            methodKind: "unary";
            input: typeof import("./gen/auth/v1/auth_pb").VerifySessionRequestSchema;
            output: typeof import("./gen/auth/v1/auth_pb").VerifySessionResponseSchema;
        };
        listCurrentCompanyMembers: {
            methodKind: "unary";
            input: typeof import("./gen/auth/v1/auth_pb").ListCurrentCompanyMembersRequestSchema;
            output: typeof import("./gen/auth/v1/auth_pb").ListCurrentCompanyMembersResponseSchema;
        };
        getSession: {
            methodKind: "unary";
            input: typeof import("./gen/auth/v1/auth_pb").GetSessionRequestSchema;
            output: typeof import("./gen/auth/v1/auth_pb").GetSessionResponseSchema;
        };
    }>>;
    userService: import("@connectrpc/connect").Client<import("@bufbuild/protobuf/codegenv2").GenService<{
        findUserByEmail: {
            methodKind: "unary";
            input: typeof import("./gen/auth/v1/auth_pb").FindUserByEmailRequestSchema;
            output: typeof import("./gen/auth/v1/auth_pb").FindUserByEmailResponseSchema;
        };
    }>>;
    companyService: import("@connectrpc/connect").Client<import("@bufbuild/protobuf/codegenv2").GenService<{
        checkMemberships: {
            methodKind: "unary";
            input: typeof import("./gen/auth/v1/auth_pb").CheckMembershipsRequestSchema;
            output: typeof import("./gen/auth/v1/auth_pb").CheckMembershipsResponseSchema;
        };
    }>>;
};
export declare function createServiceKeyInterceptor(serviceKey: string): Interceptor;
export {};
//# sourceMappingURL=server.d.ts.map