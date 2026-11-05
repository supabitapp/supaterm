const NS_HAPTIC_FEEDBACK_PATTERN_ALIGNMENT = 1n;
const NS_HAPTIC_FEEDBACK_PERFORMANCE_TIME_NOW = 1n;

let performAlignment: Promise<() => void> | undefined;

function loadAlignmentPerformer() {
  return import("ffi-rs").then(({ DataType, load, open }) => {
    const library = "supaterm-haptics-objc";
    open({ library, path: "/usr/lib/libobjc.A.dylib" });
    const call = (funcName: string, value: string) =>
      load({
        library,
        funcName,
        retType: DataType.BigInt,
        paramsType: [DataType.String],
        paramsValue: [value],
      }) as bigint;
    const managerClass = call("objc_getClass", "NSHapticFeedbackManager");
    const defaultPerformer = call("sel_registerName", "defaultPerformer");
    const perform = call("sel_registerName", "performFeedbackPattern:performanceTime:");
    return () => {
      // Apple asks for the performer per use; it changes with input devices and preferences.
      const performer = load({
        library,
        funcName: "objc_msgSend",
        retType: DataType.BigInt,
        paramsType: [DataType.BigInt, DataType.BigInt],
        paramsValue: [managerClass, defaultPerformer],
      }) as bigint;
      load({
        library,
        funcName: "objc_msgSend",
        retType: DataType.Void,
        paramsType: [DataType.BigInt, DataType.BigInt, DataType.BigInt, DataType.BigInt],
        paramsValue: [
          performer,
          perform,
          NS_HAPTIC_FEEDBACK_PATTERN_ALIGNMENT,
          NS_HAPTIC_FEEDBACK_PERFORMANCE_TIME_NOW,
        ],
      });
    };
  });
}

export async function performMacAlignmentHaptic() {
  (await (performAlignment ??= loadAlignmentPerformer()))();
}
