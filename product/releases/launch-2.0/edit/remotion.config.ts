import { Config } from '@remotion/cli/config';

// Raw recordings stay in ../footage (never copied); staticFile() resolves there.
Config.setPublicDir('../footage');
Config.setVideoImageFormat('jpeg');
Config.setCodec('h264');
Config.setCrf(16);
