export const CONSTANTS = {
  REGEX_LOOPBACK: new RegExp(
    "^" +
      "(?:(?:10|127)(?:\\.\\d{1,3}){3})" +
      "|" +
      "(?:(?:169\\.254|192\\.168|192\\.0)(?:\\.\\d{1,3}){2})" +
      "|" +
      "(?:172\\.(?:1[6-9]|2\\d|3[0-1])(?:\\.\\d{1,3}){2})" +
      "$",
    "i",
  ),

  REGEX_CONTENT_TYPE_IMAGE: new RegExp("image/.*", "i"),

  REGEX_CONTENT_TYPE_AUDIO: new RegExp("audio/.*", "i"),

  REGEX_CONTENT_TYPE_VIDEO: new RegExp("video/.*", "i"),

  REGEX_CONTENT_TYPE_TEXT: new RegExp("text/.*", "i"),

  REGEX_CONTENT_TYPE_APPLICATION: new RegExp("application/.*", "i"),
};
