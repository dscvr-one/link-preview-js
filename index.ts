import cheerio from 'cheerio';
import { fetch } from 'cross-fetch';
import AbortController from 'abort-controller';
import { CONSTANTS } from './constants';

type ILinkPreviewOptions = {
  headers?: Record<string, string>;
  imagesPropertyType?: string;
  proxyUrl?: string;
  timeout?: number;
  followRedirects?: `follow` | `error` | `manual`;
  resolveDNSHost?: (url: string) => Promise<string>;
  handleRedirects?: (baseURL: string, forwardedURL: string) => boolean;
};

type IPreFetchedResource = {
  headers?: Record<string, string>;
  status?: number;
  imagesPropertyType?: string;
  proxyUrl?: string;
  url: string;
  data?: string;
  response?: Response;
};

const throwOnLoopback = (address: string) => {
  if (CONSTANTS.REGEX_LOOPBACK.test(address)) {
    throw new Error('SSRF request detected, trying to query host');
  }
};

const metaTag = (doc: cheerio.Root, type: string, attr: string) => {
  const nodes = doc(`meta[${attr}='${type}']`);
  return nodes.length ? nodes : null;
};

const metaTagContent = (doc: cheerio.Root, type: string, attr: string) => {
  return doc(`meta[${attr}='${type}']`).attr(`content`);
};

const getTitle = (doc: cheerio.Root) => {
  let title =
    metaTagContent(doc, `og:title`, `property`) ||
    metaTagContent(doc, `og:title`, `name`);
  if (!title) {
    title = doc(`title`).text();
  }
  return title;
};

const getSiteName = (doc: cheerio.Root) => {
  const siteName =
    metaTagContent(doc, `og:site_name`, `property`) ||
    metaTagContent(doc, `og:site_name`, `name`);
  return siteName;
};

const getDescription = (doc: cheerio.Root) => {
  const description =
    metaTagContent(doc, `description`, `name`) ||
    metaTagContent(doc, `Description`, `name`) ||
    metaTagContent(doc, `og:description`, `property`);
  return description;
};

const getMediaType = (doc: cheerio.Root) => {
  const node = metaTag(doc, `medium`, `name`);
  if (node) {
    const content = node.attr(`content`);
    return content === `image` ? `photo` : content;
  }
  return (
    metaTagContent(doc, `og:type`, `property`) ||
    metaTagContent(doc, `og:type`, `name`)
  );
};

const getImages = (
  doc: cheerio.Root,
  rootUrl: string,
  imagesPropertyType?: string,
) => {
  let images: string[] = [];
  let nodes: cheerio.Cheerio | null;
  let src: string | undefined;
  let dic: Record<string, boolean> = {};

  const imagePropertyType = imagesPropertyType ?? `og`;
  nodes =
    metaTag(doc, `${imagePropertyType}:image`, `property`) ||
    metaTag(doc, `${imagePropertyType}:image`, `name`);

  if (nodes) {
    nodes.each((_: number, node: cheerio.Element) => {
      if (node.type === `tag`) {
        src = node.attribs.content;
        if (src) {
          src = new URL(src, rootUrl).toString();
          images.push(src);
        }
      }
    });
  }

  if (images.length <= 0 && !imagesPropertyType) {
    src = doc(`link[rel=image_src]`).attr(`href`);
    if (src) {
      src = new URL(src, rootUrl).toString();
      images = [src];
    } else {
      nodes = doc(`img`);

      if (nodes?.length) {
        dic = {};
        images = [];
        nodes.each((_: number, node: cheerio.Element) => {
          if (node.type === `tag`) src = node.attribs.src;
          if (src && !dic[src]) {
            dic[src] = true;
            // width = node.attribs.width;
            // height = node.attribs.height;
            images.push(new URL(src, rootUrl).toString());
          }
        });
      }
    }
  }

  return images;
};

const getVideos = (doc: cheerio.Root) => {
  const videos = [];
  let nodeTypes;
  let nodeSecureUrls;
  let nodeType;
  let nodeSecureUrl;
  let video;
  let videoType;
  let videoSecureUrl;
  let width;
  let height;
  let videoObj;
  let index;

  const nodes =
    metaTag(doc, `og:video`, `property`) || metaTag(doc, `og:video`, `name`);

  if (nodes?.length) {
    nodeTypes =
      metaTag(doc, `og:video:type`, `property`) ||
      metaTag(doc, `og:video:type`, `name`);
    nodeSecureUrls =
      metaTag(doc, `og:video:secure_url`, `property`) ||
      metaTag(doc, `og:video:secure_url`, `name`);
    width =
      metaTagContent(doc, `og:video:width`, `property`) ||
      metaTagContent(doc, `og:video:width`, `name`);
    height =
      metaTagContent(doc, `og:video:height`, `property`) ||
      metaTagContent(doc, `og:video:height`, `name`);

    for (index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.type === `tag`) video = node.attribs.content;

      nodeType = nodeTypes?.[index];
      if (nodeType?.type === `tag`) {
        videoType = nodeType ? nodeType.attribs.content : null;
      }

      nodeSecureUrl = nodeSecureUrls?.[index];
      if (nodeSecureUrl?.type === `tag`) {
        videoSecureUrl = nodeSecureUrl ? nodeSecureUrl.attribs.content : null;
      }

      videoObj = {
        url: video,
        secureUrl: videoSecureUrl,
        type: videoType,
        width,
        height,
      };
      if (videoType && videoType.indexOf(`video/`) === 0) {
        videos.splice(0, 0, videoObj);
      } else {
        videos.push(videoObj);
      }
    }
  }

  return videos;
};

// returns default favicon (//hostname/favicon.ico) for a url
const getDefaultFavicon = (rootUrl: string) => {
  return new URL(`/favicon.ico`, rootUrl);
};

// returns an array of URLs to favicon images
const getFavicons = (doc: cheerio.Root, rootUrl: string) => {
  const images = [];
  let nodes: cheerio.Cheerio | never[] = [];
  let src: string | undefined;

  const relSelectors = [
    `rel=icon`,
    `rel="shortcut icon"`,
    `rel=apple-touch-icon`,
  ];

  relSelectors.forEach((relSelector) => {
    // look for all icon tags
    nodes = doc(`link[${relSelector}]`);

    // collect all images from icon tags
    if (nodes.length) {
      nodes.each((_: number, node: cheerio.Element) => {
        if (node.type === `tag`) src = node.attribs.href;
        if (src) {
          src = new URL(src, rootUrl).toString();
          images.push(src);
        }
      });
    }
  });

  // if no icon images, use default favicon location
  if (images.length <= 0) {
    images.push(getDefaultFavicon(rootUrl));
  }

  return images;
};

const parseImageResponse = (url: string, contentType: string) => {
  return {
    url,
    mediaType: `image`,
    contentType,
    favicons: [getDefaultFavicon(url)],
  };
};

const parseAudioResponse = (url: string, contentType: string) => {
  return {
    url,
    mediaType: `audio`,
    contentType,
    favicons: [getDefaultFavicon(url)],
  };
};

const parseVideoResponse = (url: string, contentType: string) => {
  return {
    url,
    mediaType: `video`,
    contentType,
    favicons: [getDefaultFavicon(url)],
  };
};

const parseApplicationResponse = (url: string, contentType: string) => {
  return {
    url,
    mediaType: `application`,
    contentType,
    favicons: [getDefaultFavicon(url)],
  };
};

const parseTextResponse = (
  body: string,
  url: string,
  options: ILinkPreviewOptions = {},
  contentType?: string,
) => {
  const doc = cheerio.load(body);

  return {
    url,
    title: getTitle(doc),
    siteName: getSiteName(doc),
    description: getDescription(doc),
    mediaType: getMediaType(doc) || `website`,
    contentType,
    images: getImages(doc, url, options.imagesPropertyType),
    videos: getVideos(doc),
    favicons: getFavicons(doc, url),
  };
};

// TODO: can use file-type package to determine mime type based on magic numbers
const parseUnknownResponse = (
  body: string,
  url: string,
  options: ILinkPreviewOptions = {},
  contentType?: string,
) => {
  return parseTextResponse(body, url, options, contentType);
};

const getData = async (response: IPreFetchedResource) => {
  if (response.data) {
    return response.data;
  }

  if (response.response) {
    return await response.response.text();
  }

  throw new Error(`link-preview-js could not fetch link information`);
};

const parseResponse = async (
  response: IPreFetchedResource,
  options?: ILinkPreviewOptions,
) => {
  try {
    // console.log("[link-preview-js] response", response);
    let contentType = response.response
      ? response.response.headers.get(`content-type`)
      : response.headers
        ? response.headers[`content-type`]
        : null;
    let contentTypeTokens: string[] = [];
    let charset = null;

    if (!contentType) {
      return parseUnknownResponse(
        await getData(response),
        response.url,
        options,
      );
    }

    if (contentType.includes(`;`)) {
      contentTypeTokens = contentType.split(`;`);
      contentType = contentTypeTokens[0];

      for (const token of contentTypeTokens) {
        if (token.indexOf('charset=') !== -1) {
          charset = token.split('=')[1];
        }
      }
    }

    // parse response depending on content type
    if (CONSTANTS.REGEX_CONTENT_TYPE_IMAGE.test(contentType)) {
      return { ...parseImageResponse(response.url, contentType), charset };
    }

    if (CONSTANTS.REGEX_CONTENT_TYPE_AUDIO.test(contentType)) {
      return { ...parseAudioResponse(response.url, contentType), charset };
    }

    if (CONSTANTS.REGEX_CONTENT_TYPE_VIDEO.test(contentType)) {
      return { ...parseVideoResponse(response.url, contentType), charset };
    }

    if (CONSTANTS.REGEX_CONTENT_TYPE_TEXT.test(contentType)) {
      return {
        ...parseTextResponse(
          await getData(response),
          response.url,
          options,
          contentType,
        ),
        charset,
      };
    }

    if (CONSTANTS.REGEX_CONTENT_TYPE_APPLICATION.test(contentType)) {
      return {
        ...parseApplicationResponse(response.url, contentType),
        charset,
      };
    }

    return {
      ...parseUnknownResponse(await getData(response), response.url, options),
      charset,
    };
  } catch (e) {
    throw new Error(
      `link-preview-js could not fetch link information ${(
        e as any
      ).toString()}`,
    );
  }
};

// Parses the text, extracts the first link it finds and does a HTTP request
// to fetch the website content, afterwards it tries to parse the internal HTML
// and extract the information via meta tags
export const getLinkPreview = async (
  text: string,
  options?: ILinkPreviewOptions,
) => {
  if (!text || typeof text !== `string`) {
    throw new Error(`link-preview-js did not receive a valid url or text`);
  }

  const detectedUrl = text
    .replace(/\n/g, ` `)
    .split(` `)
    .find((token) => {
      try {
        const url = new URL(token);
        return (
          url.protocol.startsWith(`http`) || url.protocol.startsWith(`https`)
        );
      } catch (e) {
        return false;
      }
    });

  if (!detectedUrl) {
    throw new Error(`link-preview-js did not receive a valid a url or text`);
  }

  if (options?.followRedirects === `manual` && !options?.handleRedirects) {
    throw new Error(
      `link-preview-js followRedirects is set to manual, but no handleRedirects function was provided`,
    );
  }

  if (!!options?.resolveDNSHost) {
    const resolvedUrl = await options.resolveDNSHost(detectedUrl);

    throwOnLoopback(resolvedUrl);
  }

  const timeout = options?.timeout ?? 3000; // 3 second timeout default
  const controller = new AbortController();
  const timeoutCounter = setTimeout(() => controller.abort(), timeout);

  const fetchOptions = {
    headers: options?.headers ?? {},
    redirect: options?.followRedirects ?? `error`,
    signal: controller.signal,
  };

  const fetchUrl = options?.proxyUrl
    ? options.proxyUrl.concat(detectedUrl)
    : detectedUrl;

  // Seems like fetchOptions type definition is out of date
  // https://github.com/node-fetch/node-fetch/issues/741
  let response = await fetch(fetchUrl, fetchOptions as any).catch((e) => {
    if (e.name === `AbortError`) {
      throw new Error(`Request timeout`);
    }

    clearTimeout(timeoutCounter);
    throw e;
  });

  if (
    response.status > 300 &&
    response.status < 309 &&
    fetchOptions.redirect === `manual` &&
    options?.handleRedirects
  ) {
    const forwardedUrl = response.headers.get(`location`) || ``;

    if (!options.handleRedirects(fetchUrl, forwardedUrl)) {
      throw new Error(`link-preview-js could not handle redirect`);
    }

    if (!!options?.resolveDNSHost) {
      const resolvedUrl = await options.resolveDNSHost(forwardedUrl);

      throwOnLoopback(resolvedUrl);
    }

    response = await fetch(forwardedUrl, fetchOptions as any);
  }

  clearTimeout(timeoutCounter);

  const normalizedResponse: IPreFetchedResource = {
    url: options?.proxyUrl
      ? response.url.replace(options.proxyUrl, ``)
      : response.url,
    response,
  };

  return await parseResponse(normalizedResponse, options);
};

// Skip the library fetching the website for you, instead pass a response object
// from whatever source you get and use the internal parsing of the HTML to return
// the necessary information
export const getPreviewFromContent = async (
  response: IPreFetchedResource,
  options?: ILinkPreviewOptions,
) => {
  if (!response || typeof response !== `object`) {
    throw new Error(`link-preview-js did not receive a valid response object`);
  }

  if (!response.url) {
    throw new Error(`link-preview-js did not receive a valid response object`);
  }

  return parseResponse(response, options);
};
