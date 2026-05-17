import React from "react";
import { Pressable } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useNavigation, CommonActions } from "@react-navigation/native";
import { Icon } from "@/components/Icon";

import DashboardScreen from "@/screens/DashboardScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { useTheme } from "@/hooks/useTheme";

export type HomeStackParamList = {
  Dashboard: undefined;
};

const Stack = createNativeStackNavigator<HomeStackParamList>();

function SearchButton() {
  const { theme } = useTheme();
  const navigation = useNavigation();

  const handlePress = () => {
    console.log("Search button pressed!");
    navigation.dispatch(
      CommonActions.navigate({
        name: "Search",
      }),
    );
  };

  return (
    <Pressable
      onPress={handlePress}
      style={{ padding: 16, marginRight: -8 }}
      hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
    >
      <Icon name="search" size={22} color={theme.text} />
    </Pressable>
  );
}

export default function HomeStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          headerTitle: () => <HeaderTitle title="StudyMind" />,
          headerRight: () => <SearchButton />,
        }}
      />
    </Stack.Navigator>
  );
}
