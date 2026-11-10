// Typing limits for form fields. One copy for the whole system: the same file is
// used by the phone app and checked against the server's copy by a backend test,
// so a box never accepts more than the server will.
import limits from "../../../shared/input-limits.json";

export default limits;
