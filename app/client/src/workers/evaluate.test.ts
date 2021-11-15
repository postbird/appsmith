import evaluate, {
  setupEvaluationEnvironment,
  evaluateAsync,
  isFunctionAsync,
} from "workers/evaluate";
import {
  DataTree,
  DataTreeWidget,
  ENTITY_TYPE,
} from "entities/DataTree/dataTreeFactory";
import { RenderModes } from "constants/WidgetConstants";

describe("evaluateSync", () => {
  const widget: DataTreeWidget = {
    bottomRow: 0,
    isLoading: false,
    leftColumn: 0,
    parentColumnSpace: 0,
    parentRowSpace: 0,
    renderMode: RenderModes.CANVAS,
    rightColumn: 0,
    topRow: 0,
    type: "INPUT_WIDGET",
    version: 0,
    widgetId: "",
    widgetName: "",
    text: "value",
    ENTITY_TYPE: ENTITY_TYPE.WIDGET,
    bindingPaths: {},
    triggerPaths: {},
    validationPaths: {},
    logBlackList: {},
  };
  const dataTree: DataTree = {
    Input1: widget,
  };
  beforeAll(() => {
    setupEvaluationEnvironment();
  });
  it("unescapes string before evaluation", () => {
    const js = '\\"Hello!\\"';
    const response = evaluate(js, {}, {});
    expect(response.result).toBe("Hello!");
  });
  it("evaluate string post unescape in v1", () => {
    const js = '[1, 2, 3].join("\\\\n")';
    const response = evaluate(js, {}, {});
    expect(response.result).toBe("1\n2\n3");
  });
  it("evaluate string without unescape in v2", () => {
    self.evaluationVersion = 2;
    const js = '[1, 2, 3].join("\\n")';
    const response = evaluate(js, {}, {});
    expect(response.result).toBe("1\n2\n3");
  });
  it("throws error for undefined js", () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    expect(() => evaluate(undefined, {})).toThrow(TypeError);
  });
  it("Returns for syntax errors", () => {
    const response1 = evaluate("wrongJS", {}, {});
    expect(response1).toStrictEqual({
      result: undefined,
      errors: [
        {
          ch: 1,
          code: "W117",
          errorMessage: "'wrongJS' is not defined.",
          errorSegment: "    const result = wrongJS",
          errorType: "LINT",
          line: 0,
          raw: `
  function closedFunction () {
    const result = wrongJS
    return result;
  }
  closedFunction()
  `,
          severity: "error",
          originalBinding: "wrongJS",
          variables: ["wrongJS", undefined, undefined, undefined],
        },
        {
          errorMessage: "ReferenceError: wrongJS is not defined",
          errorType: "PARSE",
          raw: `
  function closedFunction () {
    const result = wrongJS
    return result;
  }
  closedFunction()
  `,
          severity: "error",
          originalBinding: "wrongJS",
        },
      ],
    });
    const response2 = evaluate("{}.map()", {}, {});
    expect(response2).toStrictEqual({
      result: undefined,
      errors: [
        {
          errorMessage: "TypeError: {}.map is not a function",
          errorType: "PARSE",
          raw: `
  function closedFunction () {
    const result = {}.map()
    return result;
  }
  closedFunction()
  `,
          severity: "error",
          originalBinding: "{}.map()",
        },
      ],
    });
  });
  it("evaluates value from data tree", () => {
    const js = "Input1.text";
    const response = evaluate(js, dataTree, {});
    expect(response.result).toBe("value");
  });
  it("disallows unsafe function calls", () => {
    const js = "setTimeout(() => {}, 100)";
    const response = evaluate(js, dataTree, {});
    expect(response).toStrictEqual({
      result: undefined,
      errors: [
        {
          errorMessage: "TypeError: setTimeout is not a function",
          errorType: "PARSE",
          raw: `
  function closedFunction () {
    const result = setTimeout(() => {}, 100)
    return result;
  }
  closedFunction()
  `,
          severity: "error",
          originalBinding: "setTimeout(() => {}, 100)",
        },
      ],
    });
  });
  it("has access to extra library functions", () => {
    const js = "_.add(1,2)";
    const response = evaluate(js, dataTree, {});
    expect(response.result).toBe(3);
  });
  it("evaluates functions with callback data", () => {
    const js = "(arg1, arg2) => arg1.value + arg2";
    const callbackData = [{ value: "test" }, "1"];
    const response = evaluate(js, dataTree, {}, callbackData);
    expect(response.result).toBe("test1");
  });
});

describe("evaluateAsync", () => {
  it("runs and completes", async () => {
    const js = "(() => new Promise((resolve) => { resolve(123) }))()";
    self.postMessage = jest.fn();
    await evaluateAsync(js, {}, "TEST_REQUEST", {});
    expect(self.postMessage).toBeCalledWith({
      requestId: "TEST_REQUEST",
      responseData: { finished: true, result: { errors: [], result: 123 } },
      type: "PROCESS_TRIGGER",
    });
    expect(self.ALLOW_ASYNC).toBe(true);
    expect(self.REQUEST_ID).toBe("TEST_REQUEST");
  });
  it("runs and returns errors", async () => {
    jest.restoreAllMocks();
    const js = "(() => new Promise((resolve) => { randomKeyword }))()";
    self.postMessage = jest.fn();
    await evaluateAsync(js, {}, "TEST_REQUEST_1", {});
    expect(self.postMessage).toBeCalledWith({
      requestId: "TEST_REQUEST_1",
      responseData: {
        finished: true,
        result: {
          errors: [
            {
              errorMessage: "ReferenceError: randomKeyword is not defined",
              errorType: "PARSE",
              originalBinding: expect.stringContaining("Promise"),
              raw: expect.stringContaining("Promise"),
              severity: "error",
            },
          ],
          result: undefined,
        },
      },
      type: "PROCESS_TRIGGER",
    });
    expect(self.ALLOW_ASYNC).toBe(true);
    expect(self.REQUEST_ID).toBe("TEST_REQUEST_1");
  });
});

describe("isFunctionAsync", () => {
  it("identifies async functions", () => {
    // eslint-disable-next-line @typescript-eslint/ban-types
    const cases: Array<{ script: Function | string; expected: boolean }> = [
      {
        script: () => {
          return 1;
        },
        expected: false,
      },
      {
        script: () => {
          return new Promise((resolve) => {
            resolve(1);
          });
        },
        expected: true,
      },
      {
        script: "() => { showAlert('yo') }",
        expected: true,
      },
    ];

    for (const testCase of cases) {
      let testFunc = testCase.script;
      if (typeof testFunc === "string") {
        testFunc = eval(testFunc);
      }
      const actual = isFunctionAsync(testFunc, {});
      expect(actual).toBe(testCase.expected);
    }
  });
});
