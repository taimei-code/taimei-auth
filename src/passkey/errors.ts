import { failure } from "../failure";

export class PasskeyRejected extends failure<PasskeyRejected>()("PasskeyRejected", {}, 400) {}
