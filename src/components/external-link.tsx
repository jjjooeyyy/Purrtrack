import * as React from 'react';
import { Linking, Pressable, Text, StyleSheet } from 'react-native';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';

interface ExternalLinkProps {
  href: string;
  children: React.ReactNode;
  style?: any;
}

export function ExternalLink({ href, children, style, ...rest }: ExternalLinkProps) {
  const handlePress = async () => {
    if (href.startsWith('http')) {
      await openBrowserAsync(href, {
        presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
      });
    } else {
      Linking.openURL(href);
    }
  };
  return (
    <Pressable onPress={handlePress} style={style} {...rest}>
      <Text style={styles.link}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    fontFamily: 'ZenMaruGothic-Regular',
    color: '#1B95E0',
    textDecorationLine: 'underline',
  },
});
