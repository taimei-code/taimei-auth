import { failure } from "../failure";

export class AlreadyExists extends failure<AlreadyExists>()("AlreadyExists", {}, 409) {}
