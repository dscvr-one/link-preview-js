import cheerio from 'cheerio';
import { fetch } from 'cross-fetch';
import AbortController from 'abort-controller';
import { CONSTANTS } from './constants';
import { fileTypeFromBuffer } from 'file-type';

interface ILinkPreviewOptions {
  headers?: Record<string, string>;
  imagesPropertyType?: string;
  proxyUrl?: string;
  timeout?: number;
  followRedirects?: `follow` | `error` | `manual`;
  resolveDNSHost?: (url: string) => Promise<string>;
  handleRedirects?: (baseURL: string, forwardedURL: string) => boolean;
}

interface IPreFetchedResource {
  status?: number;
  imagesPropertyType?: string;
  proxyUrl?: string;
  url: string;
  response: Response;
}

export type LinkPreview = {
  url: string;
  title?: string;
  siteName?: string | undefined;
  description?: string | undefined;
  mediaType: string;
  contentType: string | undefined;
  images?: string[];
  videos?: {
    url: string | undefined;
    secureUrl: string | null | undefined;
    type: string | null | undefined;
    width: string | undefined;
    height: string | undefined;
  }[];
  favicons?: URL[];
  charset?: string;
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

/**
 *
 * @param doc
 */
function getMediaType(doc: cheerio.Root) {
  const node = metaTag(doc, `medium`, `name`);
  if (node) {
    const content = node.attr(`content`);
    return content === `image` ? `photo` : content;
  }
  return (
    metaTagContent(doc, `og:type`, `property`) ||
    metaTagContent(doc, `og:type`, `name`)
  );
}

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
): LinkPreview => {
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

/// Read SAMPLE_SIZE bytes for file type as an ArrayBuffer
const readBytesForFileType = async (response: Response) => {
  // We get this from the file-type package as the sample size
  const SAMPLE_SIZE = 4100;

  // If the body doesn't have a reader then we use get the array buffer directly from the response
  if (!response.body || !response.body.getReader) {
    return await response.arrayBuffer();
  }

  const reader = response.body.getReader();

  // we use the streaming API to aggregate the first append the first SAMPLE_SIZE bytes
  // from the response
  const buffer = new Uint8Array(SAMPLE_SIZE);
  let offset = 0;
  let chunk;
  while (!(chunk = await reader.read()).done) {
    if (chunk.value.length + offset > SAMPLE_SIZE) {
      const subChunk = chunk.value.subarray(0, SAMPLE_SIZE - offset);
      buffer.set(subChunk, offset);
      offset = SAMPLE_SIZE;
      break;
    } else {
      buffer.set(chunk.value, offset);
      offset += chunk.value.length;
    }
  }

  return buffer.subarray(0, offset);
};

const parseResponse = async (
  response: IPreFetchedResource,
  options?: ILinkPreviewOptions,
): Promise<LinkPreview> => {
  if (!response.response.ok) {
    throw new Error(
      `link-preview-js unexpected status in response ${response.response.status} ${response.response.statusText}`,
    );
  }

  try {
    let contentType = response.response.headers.get(`content-type`);
    let contentTypeTokens: string[] = [];
    let charset;

    // If the content type is sufficiently vague, then use the file type package to
    // determine the content type via magic numbers.
    if (
      !contentType ||
      ['application/octet-stream', 'video', 'audio'].includes(contentType)
    ) {
      const buffer = await readBytesForFileType(response.response);
      const fileType = await fileTypeFromBuffer(buffer);
      if (!fileType) {
        const text = new TextDecoder().decode(buffer);
        return parseTextResponse(text, response.url, options);
      } else {
        contentType = fileType.mime;
      }
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
          await response.response.text(),
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
      ...(await parseTextResponse(
        await response.response.text(),
        response.url,
        options,
      )),
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

//  Parses the text, extracts the first link it finds and does a HTTP request
//  to fetch the website content, afterwards it tries to parse the internal HTML
//  and extract the information via meta tags
export const getLinkPreview = async (
  text: string,
  options?: ILinkPreviewOptions,
): Promise<LinkPreview> => {
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
