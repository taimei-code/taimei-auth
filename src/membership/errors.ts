import { failure } from "../failure";

export class LastOwner extends failure<LastOwner>()("LastOwner", {}, 409) {}

export class AlreadyOwner extends failure<AlreadyOwner>()("AlreadyOwner", {}, 400) {}
